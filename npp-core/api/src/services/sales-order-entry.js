import * as legacy from './sales-order-entry-legacy.js';
import * as commercialRepository from '../db/repositories/sales-order-commercial.js';
import * as systemSalesChannelRepository from '../db/repositories/system-sales-channel.js';
import { resolveDefaultWarehouseId } from './sales-order-search-preview.js';

export * from './sales-order-entry-legacy.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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

export async function getSalesOrderEntrySettings(client, { requestContext }) {
  const [base, channels, defaultSalesChannelId, defaultWarehouseId] = await Promise.all([
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
      defaultWarehouseId,
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
      }),
    }),
  });
}

export async function normalizeSalesOrderEntryPayload(client, args) {
  const normalized = await legacy.normalizeSalesOrderEntryPayload(client, args);
  if (!normalized.ok) return normalized;
  const installationId = args.requestContext.installationId;
  let salesChannelId = String(
    normalized.payload.salesChannelId ?? args.payload?.salesChannelId ?? '',
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
      'Kênh bán hàng không tồn tại, đã ngưng hoạt động hoặc không thuộc installation',
    );
  }
  const channel = await commercialRepository.getActiveSalesChannel(client, {
    installationId,
    id: salesChannelId,
  });
  if (!channel) {
    return failure(
      'SALES_CHANNEL_NOT_FOUND',
      'Kênh bán hàng không tồn tại, đã ngưng hoạt động hoặc không thuộc installation',
    );
  }
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
});
