import * as salesOrderEntryService from './sales-order-entry.js';
import * as pricingService from './pricing.js';
import * as systemSalesChannelRepository from '../db/repositories/system-sales-channel.js';
import { loadDemandHoldAvailability, parseHoldQuantity } from './sales-fulfillment-hold.js';
import * as fulfillmentRepository from '../db/repositories/sales-fulfillment.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCALE = 1_000_000_000_000n;
const RETAIL_CHANNEL = Object.freeze({
  code: 'RETAIL',
  name: 'Retail',
  description: 'Kênh hệ thống bán trực tiếp tại quầy.',
});

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function warehouseAllowed(requestContext, warehouseId) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    && requestContext.scopes.warehouseIds.includes(warehouseId);
}

function formatRetailQuantity(value) {
  const whole = value / SCALE;
  const fraction = String(value % SCALE).padStart(12, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function convertBaseToSalesQuantity(baseQuantity, conversionToBase) {
  const base = parseHoldQuantity(baseQuantity);
  const conversion = parseHoldQuantity(conversionToBase);
  if (base === null || conversion === null || conversion <= 0n) return null;
  return formatRetailQuantity((base * SCALE) / conversion);
}

async function ensureRetailChannel(client, requestContext) {
  const channel = await systemSalesChannelRepository.ensureSystemSalesChannel(client, {
    installationId: requestContext.installationId,
    ...RETAIL_CHANNEL,
    actorId: requestContext.actorId,
  });
  if (!channel || channel.is_active !== true) {
    return failure('SALES_CHANNEL_NOT_FOUND', 'Kênh bán Retail chưa sẵn sàng');
  }
  return Object.freeze({ ok: true, channel });
}

async function loadOrderLines(client, { installationId, salesOrderId }) {
  const result = await client.query(
    `SELECT orders.id AS sales_order_id,
            orders.status AS sales_order_status,
            version.warehouse_id,
            line.id AS sales_order_line_id,
            line.line_number,
            line.variant_id,
            line.sku_snapshot,
            line.item_name_snapshot,
            line.unit_code_snapshot,
            line.conversion_to_base,
            product.is_inventory_managed,
            demand.id AS fulfillment_demand_id,
            ARRAY(
              SELECT base_variant.id
                FROM shared.product_variants base_variant
               WHERE base_variant.installation_id = line.installation_id
                 AND base_variant.product_id = variant.product_id
                 AND base_variant.is_inventory_base = true
                 AND base_variant.is_active = true
               ORDER BY base_variant.id
            ) AS base_variant_ids
       FROM sales.sales_orders orders
       JOIN sales.sales_order_versions version
         ON version.installation_id = orders.installation_id
        AND version.sales_order_id = orders.id
        AND version.version_number = orders.current_version_number
       JOIN sales.sales_order_version_lines line
         ON line.installation_id = version.installation_id
        AND line.sales_order_version_id = version.id
       JOIN shared.product_variants variant
         ON variant.installation_id = line.installation_id
        AND variant.id = line.variant_id
       JOIN shared.products product
         ON product.installation_id = variant.installation_id
        AND product.id = variant.product_id
       LEFT JOIN sales.sales_order_fulfillment_demands demand
         ON demand.installation_id = line.installation_id
        AND demand.sales_order_id = orders.id
        AND demand.sales_order_line_id = line.id
        AND demand.state = 'ACTIVE'
      WHERE orders.installation_id = $1
        AND orders.id = $2::uuid
      ORDER BY line.line_number, line.id`,
    [installationId, salesOrderId],
  );
  return result.rows ?? [];
}

export async function searchRetailCatalog(client, {
  requestContext,
  search,
  categoryId = null,
  limit = 30,
  offset = 0,
}) {
  if (categoryId !== null && !UUID_PATTERN.test(String(categoryId))) {
    return failure('INVALID_CATEGORY_ID', 'Nhóm sản phẩm không hợp lệ');
  }
  const result = await salesOrderEntryService.searchSalesOrderSkuOptions(client, {
    requestContext,
    search,
    categoryId,
    retailSearch: true,
    limit,
    offset,
  });
  if (!result.ok) return result;
  return Object.freeze({
    ok: true,
    products: Object.freeze(result.skuOptions.map((option) => Object.freeze({
      id: option.id,
      productId: option.productId,
      productCode: option.productCode,
      imageKey: option.productCode,
      productName: option.productName,
      sku: option.sku,
      variantName: option.variantName,
      barcode: option.barcode,
      unitId: option.unitId,
      unitCode: option.unitCode,
      unitName: option.unitName,
      allowsFractional: option.allowsFractional,
    }))),
  });
}

export async function resolveRetailPrice(client, {
  requestContext,
  payload,
}) {
  if (!UUID_PATTERN.test(String(payload?.variantId ?? ''))) {
    return failure('VARIANT_NOT_FOUND', 'Sản phẩm không hợp lệ');
  }
  const retailChannel = await ensureRetailChannel(client, requestContext);
  if (!retailChannel.ok) return retailChannel;
  const result = await pricingService.resolvePrice(client, {
    installationId: requestContext.installationId,
    payload: {
      variantId: payload.variantId,
      quantity: payload.quantity ?? '1',
      currencyCode: 'VND',
      channelId: retailChannel.channel.id,
      ...(payload.customerId ? { customerId: payload.customerId } : {}),
    },
  });
  if (!result.ok) return result;
  return Object.freeze({
    ok: true,
    resolution: Object.freeze({
      finalUnitPriceMinor: result.resolution.finalUnitPriceMinor,
      lineTotalMinor: result.resolution.lineTotalMinor,
      resolutionFingerprint: result.resolution.resolutionFingerprint,
      channelId: retailChannel.channel.id,
      channelCode: retailChannel.channel.code,
      channelName: retailChannel.channel.name,
    }),
  });
}

export async function getRetailOrderAvailability(client, {
  requestContext,
  salesOrderId,
}) {
  if (!UUID_PATTERN.test(String(salesOrderId ?? ''))) {
    return failure('INVALID_SALES_ORDER_ID', 'Đơn bán hàng không hợp lệ');
  }
  const lines = await loadOrderLines(client, {
    installationId: requestContext.installationId,
    salesOrderId,
  });
  if (!lines.length) return failure('SALES_ORDER_NOT_FOUND', 'Không tìm thấy đơn bán hàng');
  if (!warehouseAllowed(requestContext, lines[0].warehouse_id)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Đơn nằm ngoài phạm vi kho được cấp quyền');
  }
  if (!['draft', 'confirmed'].includes(lines[0].sales_order_status)) {
    return failure('RETAIL_AVAILABILITY_NOT_AVAILABLE', 'Chỉ có thể xem Khả dụng khi đơn đang lập hoặc đã Chốt');
  }

  const availability = await Promise.all(lines.map(async (line) => {
    const common = {
      salesOrderLineId: line.sales_order_line_id,
      lineNumber: Number(line.line_number),
      variantId: line.variant_id,
      sku: line.sku_snapshot,
      itemName: line.item_name_snapshot,
      unitCode: line.unit_code_snapshot,
    };
    if (line.is_inventory_managed === false) {
      return Object.freeze({ ...common, availabilityStatus: 'NOT_APPLICABLE', availableQuantity: null });
    }
    if (!Array.isArray(line.base_variant_ids) || line.base_variant_ids.length !== 1) {
      return Object.freeze({ ...common, availabilityStatus: 'UNAVAILABLE', availableQuantity: null });
    }
    const baseAvailable = line.fulfillment_demand_id
      ? (await loadDemandHoldAvailability(client, {
          installationId: requestContext.installationId,
          demandId: line.fulfillment_demand_id,
        }))?.capacityBaseQuantity
      : await fulfillmentRepository.getWarehouseAvailableQuantity(client, {
          installationId: requestContext.installationId,
          warehouseId: line.warehouse_id,
          baseVariantId: line.base_variant_ids[0],
          excludingSalesOrderId: salesOrderId,
        });
    const availableQuantity = convertBaseToSalesQuantity(baseAvailable, line.conversion_to_base);
    return Object.freeze({
      ...common,
      availabilityStatus: availableQuantity === null ? 'UNAVAILABLE' : 'AVAILABLE',
      availableQuantity,
    });
  }));
  return Object.freeze({ ok: true, availability: Object.freeze(availability) });
}

export const retailCatalogInternals = Object.freeze({
  convertBaseToSalesQuantity,
  formatRetailQuantity,
  warehouseAllowed,
  loadOrderLines,
  ensureRetailChannel,
});
