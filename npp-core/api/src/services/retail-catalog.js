import * as salesOrderEntryService from './sales-order-entry.js';
import * as pricingService from './pricing.js';
import * as systemSalesChannelRepository from '../db/repositories/system-sales-channel.js';
import { loadDemandHoldAvailability, parseHoldQuantity } from './sales-fulfillment-hold.js';
import * as fulfillmentRepository from '../db/repositories/sales-fulfillment.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCALE = 1_000_000_000_000n;
const NO_SALES_ORDER_ID = '00000000-0000-0000-0000-000000000000';
const RETAIL_CHANNEL = Object.freeze({
  code: 'RETAIL',
  name: 'Retail',
  description: 'Kênh hệ thống bán trực tiếp tại quầy.',
});
const RETAIL_PRICE_BATCH_LIMIT = 100;
const RETAIL_PRICE_BATCH_CONCURRENCY = 4;

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

async function loadVariantAvailabilityInput(client, { installationId, variantId }) {
  const result = await client.query(
    `SELECT variant.id AS variant_id,
            variant.sku,
            variant.conversion_to_base,
            product.name AS item_name,
            product.is_inventory_managed,
            ARRAY(
              SELECT base_variant.id
                FROM shared.product_variants base_variant
               WHERE base_variant.installation_id = variant.installation_id
                 AND base_variant.product_id = variant.product_id
                 AND base_variant.is_inventory_base = true
                 AND base_variant.is_active = true
               ORDER BY base_variant.id
            ) AS base_variant_ids
       FROM shared.product_variants variant
       JOIN shared.products product
         ON product.installation_id = variant.installation_id
        AND product.id = variant.product_id
      WHERE variant.installation_id = $1
        AND variant.id = $2::uuid
        AND variant.is_active = true
        AND product.is_active = true
      LIMIT 1`,
    [installationId, variantId],
  );
  return result.rows?.[0] ?? null;
}


async function loadVariantAvailabilityInputs(client, { installationId, variantIds }) {
  if (!Array.isArray(variantIds) || variantIds.length === 0) return [];
  const result = await client.query(
    `SELECT variant.id AS variant_id,
            variant.sku,
            variant.conversion_to_base,
            product.name AS item_name,
            product.is_inventory_managed,
            ARRAY(
              SELECT base_variant.id
                FROM shared.product_variants base_variant
               WHERE base_variant.installation_id = variant.installation_id
                 AND base_variant.product_id = variant.product_id
                 AND base_variant.is_inventory_base = true
                 AND base_variant.is_active = true
               ORDER BY base_variant.id
            ) AS base_variant_ids
       FROM shared.product_variants variant
       JOIN shared.products product
         ON product.installation_id = variant.installation_id
        AND product.id = variant.product_id
      WHERE variant.installation_id = $1
        AND variant.id = ANY($2::uuid[])
        AND variant.is_active = true
        AND product.is_active = true`,
    [installationId, variantIds],
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

function retailPricePayload(payload, retailChannel) {
  return {
    variantId: payload.variantId,
    quantity: payload.quantity ?? '1',
    currencyCode: 'VND',
    channelId: retailChannel.id,
    allowMissingBasePrice: true,
    ...(payload.customerId ? { customerId: payload.customerId } : {}),
  };
}

function retailPriceResult(result, { variantId, quantity }, retailChannel) {
  if (!result.ok) {
    const status = result.code === 'BASE_PRICE_NOT_FOUND'
      ? 'MANUAL_PRICE_REQUIRED'
      : result.code === 'VARIANT_NOT_PRICEABLE'
        ? 'NOT_PRICEABLE'
        : 'ERROR';
    return Object.freeze({
      variantId,
      quantity,
      status,
      code: result.code,
      message: result.message,
      retryable: Boolean(result.retryable),
      channelCode: retailChannel.code,
    });
  }

  if (result.resolution?.resolutionStatus === 'MANUAL_PRICE_REQUIRED') {
    return Object.freeze({
      variantId,
      quantity,
      status: 'MANUAL_PRICE_REQUIRED',
      code: result.resolution.code ?? 'BASE_PRICE_NOT_FOUND',
      message: result.resolution.message ?? 'Chưa có giá Công Ty.',
      retryable: false,
      channelCode: retailChannel.code,
    });
  }

  return Object.freeze({
    variantId,
    quantity,
    status: 'OK',
    finalUnitPriceMinor: result.resolution.finalUnitPriceMinor,
    lineTotalMinor: result.resolution.lineTotalMinor,
    resolutionFingerprint: result.resolution.resolutionFingerprint,
    channelId: retailChannel.id,
    channelCode: retailChannel.code,
    channelName: retailChannel.name,
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
  const quantity = String(payload?.quantity ?? '1');
  const result = await pricingService.resolvePrice(client, {
    installationId: requestContext.installationId,
    payload: retailPricePayload({ ...payload, quantity }, retailChannel.channel),
  });
  if (!result.ok) return result;
  return Object.freeze({
    ok: true,
    resolution: retailPriceResult(result, { variantId: payload.variantId, quantity }, retailChannel.channel),
  });
}

export async function resolveRetailPrices(client, {
  requestContext,
  payload,
}) {
  const items = Array.isArray(payload?.items) ? payload.items : null;
  if (!items || items.length === 0 || items.length > RETAIL_PRICE_BATCH_LIMIT) {
    return failure('INVALID_PRICE_ITEMS', `Danh sách tính giá phải có từ 1 đến ${RETAIL_PRICE_BATCH_LIMIT} sản phẩm`);
  }
  const normalized = items.map((item) => ({
    variantId: String(item?.variantId ?? '').trim(),
    quantity: String(item?.quantity ?? '1').trim() || '1',
  }));
  if (normalized.some((item) => !UUID_PATTERN.test(item.variantId))) {
    return failure('INVALID_PRICE_ITEMS', 'Danh sách sản phẩm cần tính giá không hợp lệ');
  }

  const retailChannel = await ensureRetailChannel(client, requestContext);
  if (!retailChannel.ok) return retailChannel;
  const customerId = payload?.customerId ? String(payload.customerId).trim() : '';
  const resolutions = new Array(normalized.length);
  let cursor = 0;
  let fatalResult = null;

  async function worker() {
    while (true) {
      if (fatalResult) return;
      const index = cursor;
      cursor += 1;
      if (index >= normalized.length) return;
      const item = normalized[index];
      const result = await pricingService.resolvePrice(client, {
        installationId: requestContext.installationId,
        payload: retailPricePayload({ ...item, ...(customerId ? { customerId } : {}) }, retailChannel.channel),
      });
      if (!result.ok && !['BASE_PRICE_NOT_FOUND', 'VARIANT_NOT_PRICEABLE'].includes(result.code)) {
        fatalResult = result;
        return;
      }
      resolutions[index] = retailPriceResult(result, item, retailChannel.channel);
    }
  }

  const workerCount = Math.min(RETAIL_PRICE_BATCH_CONCURRENCY, normalized.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (fatalResult) return fatalResult;
  return Object.freeze({ ok: true, resolutions: Object.freeze(resolutions) });
}

export async function previewRetailAvailability(client, {
  requestContext,
  payload,
}) {
  const warehouseId = String(payload?.warehouseId ?? '').trim();
  if (!UUID_PATTERN.test(warehouseId)) {
    return failure('INVALID_WAREHOUSE_ID', 'Kho bán không hợp lệ');
  }
  if (!warehouseAllowed(requestContext, warehouseId)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Kho nằm ngoài phạm vi được cấp quyền');
  }

  const requestedVariantIds = Array.isArray(payload?.variantIds)
    ? [...new Set(payload.variantIds.map((value) => String(value ?? '').trim()))]
    : [];
  if (!requestedVariantIds.length || requestedVariantIds.length > 100 || requestedVariantIds.some((id) => !UUID_PATTERN.test(id))) {
    return failure('INVALID_VARIANT_IDS', 'Danh sách sản phẩm cần kiểm tra không hợp lệ');
  }

  let excludingSalesOrderId = NO_SALES_ORDER_ID;
  const salesOrderId = payload?.salesOrderId === null || payload?.salesOrderId === undefined
    ? null
    : String(payload.salesOrderId).trim();
  if (salesOrderId !== null) {
    if (!UUID_PATTERN.test(salesOrderId)) return failure('INVALID_SALES_ORDER_ID', 'Đơn bán hàng không hợp lệ');
    const sourceLines = await loadOrderLines(client, {
      installationId: requestContext.installationId,
      salesOrderId,
    });
    if (!sourceLines.length) return failure('SALES_ORDER_NOT_FOUND', 'Không tìm thấy đơn bán hàng');
    if (!warehouseAllowed(requestContext, sourceLines[0].warehouse_id)) {
      return failure('WAREHOUSE_SCOPE_DENIED', 'Đơn nằm ngoài phạm vi kho được cấp quyền');
    }
    if (String(sourceLines[0].warehouse_id) !== warehouseId) {
      return failure('RETAIL_AVAILABILITY_WAREHOUSE_MISMATCH', 'Kho đang sửa phải trùng với kho của đơn');
    }
    excludingSalesOrderId = salesOrderId;
  }

  const variantRows = await loadVariantAvailabilityInputs(client, {
    installationId: requestContext.installationId,
    variantIds: requestedVariantIds,
  });
  const variantsById = new Map(variantRows.map((row) => [String(row.variant_id), row]));
  const baseVariantIds = [...new Set(variantRows
    .filter((row) => row.is_inventory_managed !== false && Array.isArray(row.base_variant_ids) && row.base_variant_ids.length === 1)
    .map((row) => String(row.base_variant_ids[0])))];
  const baseAvailabilityRows = baseVariantIds.length
    ? await fulfillmentRepository.getWarehouseAvailableQuantities(client, {
        installationId: requestContext.installationId,
        warehouseId,
        baseVariantIds,
        excludingSalesOrderId,
      })
    : [];
  const availableByBaseVariant = new Map(
    baseAvailabilityRows.map((row) => [String(row.base_variant_id), row.available_quantity]),
  );

  const availability = requestedVariantIds.map((variantId) => {
    const row = variantsById.get(variantId);
    if (!row) {
      return Object.freeze({ variantId, availabilityStatus: 'UNAVAILABLE', availableQuantity: null });
    }
    if (row.is_inventory_managed === false) {
      return Object.freeze({ variantId, availabilityStatus: 'NOT_APPLICABLE', availableQuantity: null });
    }
    if (!Array.isArray(row.base_variant_ids) || row.base_variant_ids.length !== 1) {
      return Object.freeze({ variantId, availabilityStatus: 'UNAVAILABLE', availableQuantity: null });
    }
    const baseAvailable = availableByBaseVariant.get(String(row.base_variant_ids[0])) ?? '0.000000000000';
    const availableQuantity = convertBaseToSalesQuantity(baseAvailable, row.conversion_to_base);
    return Object.freeze({
      variantId,
      availabilityStatus: availableQuantity === null ? 'UNAVAILABLE' : 'AVAILABLE',
      availableQuantity,
    });
  });

  return Object.freeze({ ok: true, availability: Object.freeze(availability) });
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

  const freeBaseVariantIds = [...new Set(lines
    .filter((line) => !line.fulfillment_demand_id
      && line.is_inventory_managed !== false
      && Array.isArray(line.base_variant_ids)
      && line.base_variant_ids.length === 1)
    .map((line) => String(line.base_variant_ids[0])))];
  const freeAvailabilityRows = freeBaseVariantIds.length
    ? await fulfillmentRepository.getWarehouseAvailableQuantities(client, {
        installationId: requestContext.installationId,
        warehouseId: lines[0].warehouse_id,
        baseVariantIds: freeBaseVariantIds,
        excludingSalesOrderId: salesOrderId,
      })
    : [];
  const freeAvailableByBaseVariant = new Map(
    freeAvailabilityRows.map((row) => [String(row.base_variant_id), row.available_quantity]),
  );

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
      : freeAvailableByBaseVariant.get(String(line.base_variant_ids[0])) ?? '0.000000000000';
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
  loadVariantAvailabilityInput,
  ensureRetailChannel,
});
