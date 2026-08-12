import * as legacy from './sales-order-entry-legacy.js';
import * as commercialRepository from '../db/repositories/sales-order-commercial.js';

export * from './sales-order-entry-legacy.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_CHANNEL_CODE_BY_TYPE = Object.freeze({ MCP: 'MCP' });

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function hasPermission(requestContext, permission) {
  return Array.isArray(requestContext?.permissions)
    && requestContext.permissions.includes(permission);
}

function sourceChannelCode(payload) {
  const sourceType = String(payload?.sourceType ?? '').trim().toUpperCase();
  return SOURCE_CHANNEL_CODE_BY_TYPE[sourceType] ?? null;
}

export async function getSalesOrderEntrySettings(client, { requestContext }) {
  const [base, channels, defaultSalesChannelId] = await Promise.all([
    legacy.getSalesOrderEntrySettings(client, { requestContext }),
    commercialRepository.listActiveSalesChannels(client, {
      installationId: requestContext.installationId,
    }),
    commercialRepository.getDefaultSalesChannelId(client, {
      installationId: requestContext.installationId,
    }),
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
    const canonicalSourceChannelCode = sourceChannelCode(normalized.payload);
    if (canonicalSourceChannelCode) {
      const channels = await commercialRepository.listActiveSalesChannels(client, {
        installationId,
      });
      const sourceChannel = channels.find((channel) => (
        String(channel.code ?? '').trim().toUpperCase() === canonicalSourceChannelCode
      ));
      if (!sourceChannel) {
        return failure(
          'SALES_CHANNEL_NOT_FOUND',
          `Chưa cấu hình kênh bán hàng ${canonicalSourceChannelCode} đang hoạt động`,
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
