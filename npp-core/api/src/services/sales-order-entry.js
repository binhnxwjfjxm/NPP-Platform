import { buildAuditRecord, insertAuditRecord } from '../audit-outbox.js';
import * as legacy from './sales-order-entry-legacy.js';
import * as commercialRepository from '../db/repositories/sales-order-commercial.js';
import * as systemSalesChannelRepository from '../db/repositories/system-sales-channel.js';
import * as warehouseRepository from '../db/repositories/warehouse.js';
import * as userPreferenceRepository from '../db/repositories/user-preferences.js';
import { resolveDefaultWarehouseId } from './sales-order-search-preview.js';

export * from './sales-order-entry-legacy.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENTRY_DEFAULTS_KEY = 'sales-order.entry-defaults';
const DELIVERY_CHOICES = new Set(['TRIP', 'MANUAL', 'PICKUP']);
const SOURCE_CHANNEL_BY_TYPE = Object.freeze({
  MCP: Object.freeze({
    code: 'MCP',
    name: 'MCP',
    description: 'Kênh hệ thống nhận đơn từ ứng dụng MCP.',
  }),
});
const RETAIL_CHANNEL = Object.freeze({
  code: 'RETAIL',
  name: 'Retail',
  description: 'Kênh hệ thống bán trực tiếp tại quầy.',
});

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function hasPermission(requestContext, permission) {
  return Array.isArray(requestContext?.permissions)
    && requestContext.permissions.includes(permission);
}

function sourceChannelDefinition(payload, requestContext) {
  if (String(requestContext?.sourceApp ?? '').trim().toLowerCase() === 'retail-web') {
    return RETAIL_CHANNEL;
  }
  const sourceType = String(payload?.sourceType ?? '').trim().toUpperCase();
  return SOURCE_CHANNEL_BY_TYPE[sourceType] ?? null;
}

function internalUserId(requestContext) {
  const match = /^user:([0-9a-f-]+)$/i.exec(String(requestContext?.actorId ?? '').trim());
  return match && UUID_PATTERN.test(match[1]) ? match[1] : null;
}

function scopedWarehouseIds(requestContext) {
  return new Set(Array.isArray(requestContext?.scopes?.warehouseIds)
    ? requestContext.scopes.warehouseIds.filter((id) => UUID_PATTERN.test(String(id ?? '')))
    : []);
}

function normalizedDeliveryChoice(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return DELIVERY_CHOICES.has(normalized) ? normalized : null;
}

async function loadEntryDefaults(client, { requestContext, systemDefaultWarehouseId }) {
  const userId = internalUserId(requestContext);
  if (!userId) {
    return Object.freeze({
      defaultWarehouseId: systemDefaultWarehouseId,
      defaultDeliveryChoice: 'TRIP',
      savedWarehouseId: null,
      savedDeliveryChoice: null,
    });
  }

  const stored = await userPreferenceRepository.getUserPreference(client, {
    installationId: requestContext.installationId,
    userId,
    preferenceKey: ENTRY_DEFAULTS_KEY,
  });
  const savedDeliveryChoice = normalizedDeliveryChoice(stored?.deliveryChoice);
  const candidateWarehouseId = UUID_PATTERN.test(String(stored?.warehouseId ?? ''))
    ? String(stored.warehouseId)
    : null;
  let savedWarehouseId = null;
  if (candidateWarehouseId && scopedWarehouseIds(requestContext).has(candidateWarehouseId)) {
    const warehouse = await warehouseRepository.getWarehouseByIdForInstallation(client, {
      id: candidateWarehouseId,
      installationId: requestContext.installationId,
    });
    if (warehouse?.is_active === true) savedWarehouseId = candidateWarehouseId;
  }

  return Object.freeze({
    defaultWarehouseId: savedWarehouseId ?? systemDefaultWarehouseId,
    defaultDeliveryChoice: savedDeliveryChoice ?? 'TRIP',
    savedWarehouseId,
    savedDeliveryChoice,
  });
}

async function persistEntryDefaults(client, { requestContext, input }) {
  if (input === undefined) return Object.freeze({ ok: true });
  const userId = internalUserId(requestContext);
  if (!userId) {
    return failure(
      'SALES_ORDER_ENTRY_DEFAULTS_FORBIDDEN',
      'Chỉ tài khoản người dùng Công Ty mới được lưu lựa chọn mặc định.',
    );
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return failure('INVALID_SALES_ORDER_ENTRY_DEFAULTS', 'Lựa chọn mặc định của đơn không hợp lệ.');
  }
  const unknownKeys = Object.keys(input).filter((key) => !['warehouseId', 'deliveryChoice'].includes(key));
  if (unknownKeys.length > 0) {
    return failure('INVALID_SALES_ORDER_ENTRY_DEFAULTS', 'Lựa chọn mặc định của đơn có trường không hợp lệ.');
  }

  let warehouseId = input.warehouseId === null ? null : String(input.warehouseId ?? '').trim() || null;
  if (warehouseId) {
    if (!UUID_PATTERN.test(warehouseId) || !scopedWarehouseIds(requestContext).has(warehouseId)) {
      return failure('WAREHOUSE_SCOPE_DENIED', 'Kho mặc định nằm ngoài phạm vi được cấp.');
    }
    const warehouse = await warehouseRepository.getWarehouseByIdForInstallation(client, {
      id: warehouseId,
      installationId: requestContext.installationId,
    });
    if (!warehouse || warehouse.is_active !== true) {
      return failure('WAREHOUSE_NOT_FOUND', 'Kho mặc định không còn hoạt động.');
    }
  }

  let deliveryChoice = input.deliveryChoice === null
    ? null
    : normalizedDeliveryChoice(input.deliveryChoice);
  if (input.deliveryChoice !== null && input.deliveryChoice !== undefined && !deliveryChoice) {
    return failure('INVALID_SALES_ORDER_ENTRY_DEFAULTS', 'Hình thức giao nhận mặc định không hợp lệ.');
  }
  if (input.deliveryChoice === undefined) deliveryChoice = null;

  const before = await userPreferenceRepository.getUserPreference(client, {
    installationId: requestContext.installationId,
    userId,
    preferenceKey: ENTRY_DEFAULTS_KEY,
  });
  const next = Object.freeze({ warehouseId, deliveryChoice });
  const beforeCanonical = JSON.stringify({
    warehouseId: UUID_PATTERN.test(String(before?.warehouseId ?? '')) ? String(before.warehouseId) : null,
    deliveryChoice: normalizedDeliveryChoice(before?.deliveryChoice),
  });
  const nextCanonical = JSON.stringify(next);
  if (beforeCanonical === nextCanonical) return Object.freeze({ ok: true });

  if (!warehouseId && !deliveryChoice) {
    await userPreferenceRepository.deleteUserPreference(client, {
      installationId: requestContext.installationId,
      userId,
      preferenceKey: ENTRY_DEFAULTS_KEY,
    });
  } else {
    await userPreferenceRepository.upsertUserPreference(client, {
      installationId: requestContext.installationId,
      userId,
      preferenceKey: ENTRY_DEFAULTS_KEY,
      preferenceValue: next,
      actorId: requestContext.actorId,
    });
  }

  await insertAuditRecord(client, buildAuditRecord({
    requestContext,
    action: 'sales.order_entry_defaults.update',
    resourceType: 'user_preference',
    resourceId: userId,
    beforeData: before ?? null,
    afterData: !warehouseId && !deliveryChoice ? null : next,
    metadata: { preferenceKey: ENTRY_DEFAULTS_KEY },
  }));
  return Object.freeze({ ok: true });
}

export async function getSalesOrderEntrySettings(client, { requestContext }) {
  const [base, channels, defaultSalesChannelId, systemDefaultWarehouseId] = await Promise.all([
    legacy.getSalesOrderEntrySettings(client, { requestContext }),
    commercialRepository.listActiveSalesChannels(client, {
      installationId: requestContext.installationId,
    }),
    commercialRepository.getDefaultSalesChannelId(client, {
      installationId: requestContext.installationId,
    }),
    resolveDefaultWarehouseId(client, { requestContext }),
  ]);
  if (!base.ok) return base;
  const defaults = await loadEntryDefaults(client, {
    requestContext,
    systemDefaultWarehouseId,
  });
  return Object.freeze({
    ok: true,
    settings: Object.freeze({
      ...base.settings,
      salesChannels: Object.freeze(channels.map((channel) => Object.freeze({
        id: channel.id,
        code: channel.code,
        name: channel.name,
      }))),
      defaultSalesChannelId,
      defaultWarehouseId: defaults.defaultWarehouseId,
      defaultDeliveryChoice: defaults.defaultDeliveryChoice,
      savedWarehouseId: defaults.savedWarehouseId,
      savedDeliveryChoice: defaults.savedDeliveryChoice,
      permissions: Object.freeze({
        canPriceOverride: hasPermission(
          requestContext,
          'core.sales-order.price.override',
        ),
        canDiscountOverride: hasPermission(
          requestContext,
          'core.sales-order.discount.override',
        ),
        canConfirm: hasPermission(requestContext, 'core.sales-order.confirm'),
        canNegativeStockIssue: hasPermission(
          requestContext,
          'core.inventory.negative-stock.issue',
        ),
      }),
    }),
  });
}

export async function normalizeSalesOrderEntryPayload(client, args) {
  const rawPayload = args.payload && typeof args.payload === 'object' && !Array.isArray(args.payload)
    ? args.payload
    : args.payload;
  const entryDefaults = rawPayload && typeof rawPayload === 'object'
    ? rawPayload.entryDefaults
    : undefined;
  const businessPayload = rawPayload && typeof rawPayload === 'object'
    ? Object.fromEntries(Object.entries(rawPayload).filter(([key]) => key !== 'entryDefaults'))
    : rawPayload;
  const normalized = await legacy.normalizeSalesOrderEntryPayload(client, {
    ...args,
    payload: businessPayload,
  });
  if (!normalized.ok) return normalized;
  const installationId = args.requestContext.installationId;
  let salesChannelId = String(
    normalized.payload.salesChannelId ?? businessPayload?.salesChannelId ?? '',
  ).trim();
  if (!salesChannelId) {
    const canonicalSourceChannel = sourceChannelDefinition(normalized.payload, args.requestContext);
    if (canonicalSourceChannel) {
      const sourceChannel = await systemSalesChannelRepository.ensureSystemSalesChannel(client, {
        installationId,
        ...canonicalSourceChannel,
        actorId: args.requestContext.actorId,
      });
      if (!sourceChannel) {
        return failure(
          'SALES_CHANNEL_NOT_FOUND',
          `Không thể khởi tạo kênh bán hàng ${canonicalSourceChannel.code}`,
        );
      }
      if (sourceChannel.is_active !== true) {
        return failure(
          'SALES_CHANNEL_NOT_FOUND',
          `Kênh bán hàng ${canonicalSourceChannel.code} đang ngừng hoạt động`,
        );
      }
      salesChannelId = sourceChannel.id;
    }
  }
  if (!salesChannelId) {
    salesChannelId = await commercialRepository.getDefaultSalesChannelId(client, {
      installationId,
    }) ?? '';
  }
  if (!salesChannelId) {
    return failure('SALES_CHANNEL_REQUIRED', 'Hãy chọn kênh bán hàng');
  }
  if (!UUID_PATTERN.test(salesChannelId)) {
    return failure(
      'SALES_CHANNEL_NOT_FOUND',
      'Kênh bán hàng không tồn tại, đã ngưng hoạt động hoặc không thuộc Công Ty',
    );
  }
  const channel = await commercialRepository.getActiveSalesChannel(client, {
    installationId,
    id: salesChannelId,
  });
  if (!channel) {
    return failure(
      'SALES_CHANNEL_NOT_FOUND',
      'Kênh bán hàng không tồn tại, đã ngưng hoạt động hoặc không thuộc Công Ty',
    );
  }
  const preferenceResult = await persistEntryDefaults(client, {
    requestContext: args.requestContext,
    input: entryDefaults,
  });
  if (!preferenceResult.ok) return preferenceResult;
  return Object.freeze({
    ok: true,
    payload: Object.freeze({
      ...normalized.payload,
      salesChannelId: channel.id,
    }),
  });
}

export const salesOrderEntryInternals = Object.freeze({
  sourceChannelDefinition,
  RETAIL_CHANNEL,
  internalUserId,
  normalizedDeliveryChoice,
  loadEntryDefaults,
  persistEntryDefaults,
  ENTRY_DEFAULTS_KEY,
});
