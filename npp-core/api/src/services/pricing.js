import * as legacy from './pricing-legacy.js';
import * as repo from '../db/repositories/pricing.js';
import {
  canonicalPricingFingerprint,
  halfUp,
  parseScaledDecimal,
} from './sales-order-commercial.js';

export * from './pricing-legacy.js';

const MONEY_PATTERN = /^(?:0|[1-9]\d{0,18})$/;
const SCALE = 1_000_000n;
const MAX_SKU_MATCH_IMPORT_ROWS = 2000;

function invalid(code, message, retryable = false) {
  return { ok: false, code, message, retryable };
}

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function decimalKey(value) {
  const normalized = text(value);
  if (!normalized) return '';
  if (!normalized.includes('.')) return normalized;
  return normalized.replace(/0+$/, '').replace(/\.$/, '') || '0';
}

function dateKey(value) {
  const normalized = text(value);
  if (!normalized) return '';
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? normalized : parsed.toISOString();
}

function identityKey(row) {
  return [
    upper(row?.priceListCode),
    upper(row?.sku),
    upper(row?.adjustmentType),
    decimalKey(row?.minQuantity ?? '0'),
    decimalKey(row?.maxQuantity),
    dateKey(row?.effectiveFrom),
    dateKey(row?.effectiveTo),
  ].join('|');
}

function matchesSkuIdentity(item, row) {
  return item.adjustment_type === upper(row.adjustmentType)
    && decimalKey(item.min_quantity) === decimalKey(row.minQuantity ?? '0')
    && decimalKey(item.max_quantity) === decimalKey(row.maxQuantity)
    && dateKey(item.effective_from) === dateKey(row.effectiveFrom)
    && dateKey(item.effective_to) === dateKey(row.effectiveTo);
}

function matchesSkuScope(item, row) {
  return item.adjustment_type === upper(row.adjustmentType)
    && decimalKey(item.min_quantity) === decimalKey(row.minQuantity ?? '0')
    && decimalKey(item.max_quantity) === decimalKey(row.maxQuantity);
}

function replacementApplyAt(payload) {
  if (payload?.replaceFrom !== true) return { ok: true, value: null };
  if (payload.applyAt === undefined || payload.applyAt === null || payload.applyAt === '') {
    return { ok: true, value: new Date().toISOString() };
  }
  const parsed = new Date(payload.applyAt);
  if (Number.isNaN(parsed.getTime())) return invalid('INVALID_DATE_TIME', 'Ngày áp dụng giá không hợp lệ');
  return { ok: true, value: parsed.toISOString() };
}

function intervalContains(item, timestamp) {
  const at = new Date(timestamp).getTime();
  const from = item.effective_from ? new Date(item.effective_from).getTime() : Number.NEGATIVE_INFINITY;
  const to = item.effective_to ? new Date(item.effective_to).getTime() : Number.POSITIVE_INFINITY;
  return from <= at && at < to;
}

function earlierBoundary(left, right) {
  if (!left) return right ?? null;
  if (!right) return left;
  return new Date(left).getTime() <= new Date(right).getTime() ? left : right;
}

async function importPricingBySku(client, { installationId, payload, createdBy }) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return invalid('INVALID_INPUT', 'Pricing import payload is required');
  }
  if ((Array.isArray(payload.channels) && payload.channels.length)
    || (Array.isArray(payload.priceLists) && payload.priceLists.length)) {
    return invalid('INVALID_IMPORT', 'SKU-keyed pricing import only accepts existing price lists and item rows');
  }
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) return invalid('INVALID_IMPORT', 'Pricing import must contain item rows');
  if (items.length > MAX_SKU_MATCH_IMPORT_ROWS) {
    return invalid('IMPORT_TOO_LARGE', `Pricing import supports at most ${MAX_SKU_MATCH_IMPORT_ROWS} items`);
  }
  const applyAtResult = replacementApplyAt(payload);
  if (!applyAtResult.ok) return applyAtResult;
  const replaceFrom = payload.replaceFrom === true;
  const applyAt = applyAtResult.value;

  const identities = new Set();
  for (const row of items) {
    const priceListCode = upper(row?.priceListCode);
    const sku = upper(row?.sku);
    const adjustmentType = upper(row?.adjustmentType);
    if (!priceListCode || !sku || !adjustmentType) {
      return invalid('INVALID_IMPORT', 'Every SKU-keyed item requires priceListCode, sku and adjustmentType');
    }
    const key = identityKey(row);
    if (identities.has(key)) {
      return invalid('IMPORT_IDENTITY_CONFLICT', `SKU ${sku} bị lặp cùng một điều kiện giá trong tệp cập nhật`);
    }
    identities.add(key);
  }

  let itemsCreated = 0;
  let itemsUpdated = 0;
  let itemsReplaced = 0;
  const listCache = new Map();
  const variantCache = new Map();
  for (const row of items) {
    const priceListCode = upper(row.priceListCode);
    const sku = upper(row.sku);
    if (!listCache.has(priceListCode)) {
      listCache.set(priceListCode, await repo.getPriceListByCode(client, { installationId, code: priceListCode }));
    }
    const list = listCache.get(priceListCode);
    if (!list) return invalid('PRICE_LIST_NOT_FOUND', `Price list ${priceListCode} not found`);
    if (!variantCache.has(sku)) {
      variantCache.set(sku, await repo.getVariantBySkuForPricing(client, { installationId, sku }));
    }
    const variant = variantCache.get(sku);
    if (!variant) return invalid('VARIANT_NOT_FOUND', `SKU ${sku} not found`);

    const allVariantItems = await repo.listPriceListItems(client, {
      installationId,
      priceListId: list.id,
      variantId: variant.id,
      active: undefined,
      limit: 2000,
      offset: 0,
    });

    if (replaceFrom) {
      const scoped = allVariantItems.filter((item) => item.is_active && matchesSkuScope(item, row));
      const exactStart = scoped.filter((item) => dateKey(item.effective_from) === dateKey(applyAt));
      if (exactStart.length > 1) {
        return invalid('IMPORT_IDENTITY_CONFLICT', `SKU ${sku} có nhiều mức giá bắt đầu cùng thời điểm trong ${priceListCode}; cần xử lý trùng trước`);
      }
      if (exactStart.length === 1) {
        const existing = exactStart[0];
        const updated = await legacy.updatePriceListItem(client, {
          installationId, priceListId: list.id, itemId: existing.id, updatedBy: createdBy,
          payload: {
            adjustmentType: upper(row.adjustmentType), amountMinor: row.amountMinor ?? null, rateBps: row.rateBps ?? null,
            minQuantity: row.minQuantity ?? '0', maxQuantity: row.maxQuantity ?? null,
            effectiveFrom: existing.effective_from, effectiveTo: existing.effective_to,
            sourceKind: row.sourceKind ?? existing.source_kind ?? 'IMPORT',
            externalRuleCode: row.externalRuleCode ?? existing.external_rule_code ?? null,
            note: row.note ?? existing.note ?? null, sourceMetadata: row.sourceMetadata ?? existing.source_metadata ?? {},
            isActive: true, expectedUpdatedAt: existing.updated_at,
          },
        });
        if (!updated.ok) return updated;
        itemsUpdated += 1; itemsReplaced += 1;
        continue;
      }

      const overlapping = scoped.filter((item) => intervalContains(item, applyAt));
      if (overlapping.length > 1) {
        return invalid('IMPORT_IDENTITY_CONFLICT', `SKU ${sku} đang có nhiều mức giá chồng thời gian trong ${priceListCode}; cần xử lý trùng trước`);
      }
      const applyAtMillis = new Date(applyAt).getTime();
      const future = scoped
        .filter((item) => item.effective_from && new Date(item.effective_from).getTime() > applyAtMillis)
        .sort((a, b) => new Date(a.effective_from).getTime() - new Date(b.effective_from).getTime())[0] ?? null;
      const current = overlapping[0] ?? null;
      const replacementEnd = earlierBoundary(current?.effective_to ?? null, future?.effective_from ?? null);

      if (current) {
        const closed = await legacy.updatePriceListItem(client, {
          installationId, priceListId: list.id, itemId: current.id, updatedBy: createdBy,
          payload: {
            adjustmentType: current.adjustment_type, amountMinor: current.amount_minor, rateBps: current.rate_bps,
            minQuantity: current.min_quantity, maxQuantity: current.max_quantity,
            effectiveFrom: current.effective_from, effectiveTo: applyAt,
            sourceKind: current.source_kind, externalRuleCode: current.external_rule_code,
            note: current.note, sourceMetadata: current.source_metadata ?? {}, isActive: true,
            expectedUpdatedAt: current.updated_at,
          },
        });
        if (!closed.ok) return closed;
        itemsUpdated += 1;
      }

      const created = await legacy.createPriceListItem(client, {
        installationId, priceListId: list.id, createdBy,
        payload: {
          variantId: variant.id, adjustmentType: upper(row.adjustmentType),
          amountMinor: row.amountMinor ?? null, rateBps: row.rateBps ?? null,
          minQuantity: row.minQuantity ?? '0', maxQuantity: row.maxQuantity ?? null,
          effectiveFrom: applyAt, effectiveTo: replacementEnd,
          sourceKind: row.sourceKind ?? 'IMPORT', sourceKey: row.sourceKey ?? null,
          externalRuleCode: row.externalRuleCode ?? null, note: row.note ?? null,
          sourceMetadata: { ...(row.sourceMetadata ?? {}), replacesPriceItemId: current?.id ?? null },
          isActive: row.isActive === undefined ? true : row.isActive,
        },
      });
      if (!created.ok) return created;
      itemsCreated += 1; itemsReplaced += 1;
      continue;
    }

    const candidates = allVariantItems.filter((item) => matchesSkuIdentity(item, row));
    const activeCandidates = candidates.filter((item) => item.is_active);
    const matching = activeCandidates.length ? activeCandidates : candidates;
    if (matching.length > 1) {
      return invalid(
        'IMPORT_IDENTITY_CONFLICT',
        `SKU ${sku} có nhiều dòng giá cùng điều kiện trong ${priceListCode}; cần xử lý trùng trước khi cập nhật hàng loạt`,
      );
    }

    const existing = matching[0] ?? null;
    if (existing) {
      const updated = await legacy.updatePriceListItem(client, {
        installationId,
        priceListId: list.id,
        itemId: existing.id,
        updatedBy: createdBy,
        payload: {
          adjustmentType: upper(row.adjustmentType),
          amountMinor: row.amountMinor ?? null,
          rateBps: row.rateBps ?? null,
          minQuantity: row.minQuantity ?? '0',
          maxQuantity: row.maxQuantity ?? null,
          effectiveFrom: row.effectiveFrom ?? null,
          effectiveTo: row.effectiveTo ?? null,
          sourceKind: row.sourceKind ?? existing.source_kind ?? 'IMPORT',
          externalRuleCode: row.externalRuleCode ?? existing.external_rule_code ?? null,
          note: row.note ?? existing.note ?? null,
          sourceMetadata: row.sourceMetadata ?? existing.source_metadata ?? {},
          isActive: row.isActive === undefined ? true : row.isActive,
          expectedUpdatedAt: existing.updated_at,
        },
      });
      if (!updated.ok) return updated;
      itemsUpdated += 1;
      continue;
    }

    const created = await legacy.createPriceListItem(client, {
      installationId,
      priceListId: list.id,
      createdBy,
      payload: {
        variantId: variant.id,
        adjustmentType: upper(row.adjustmentType),
        amountMinor: row.amountMinor ?? null,
        rateBps: row.rateBps ?? null,
        minQuantity: row.minQuantity ?? '0',
        maxQuantity: row.maxQuantity ?? null,
        effectiveFrom: row.effectiveFrom ?? null,
        effectiveTo: row.effectiveTo ?? null,
        sourceKind: row.sourceKind ?? 'IMPORT',
        sourceKey: row.sourceKey ?? null,
        externalRuleCode: row.externalRuleCode ?? null,
        note: row.note ?? null,
        sourceMetadata: row.sourceMetadata ?? {},
        isActive: row.isActive === undefined ? true : row.isActive,
      },
    });
    if (!created.ok) return created;
    itemsCreated += 1;
  }

  return {
    ok: true,
    import: {
      id: text(payload.sourceBatchId) || 'pricing-sku-import',
      channelsCreated: 0,
      listsCreated: 0,
      itemsCreated,
      itemsUpdated,
      itemsReplaced,
      totalItems: items.length,
    },
  };
}

export async function importPricing(client, args) {
  if (args?.payload?.matchBySku === true) return importPricingBySku(client, args);
  return legacy.importPricing(client, args);
}

function manualValue(payload) {
  const supplied = payload?.manualUnitPriceMinor !== undefined
    && payload?.manualUnitPriceMinor !== null
    && payload?.manualUnitPriceMinor !== '';
  if (!supplied) return { ok: true, supplied: false, value: null, reason: null };
  const value = String(payload.manualUnitPriceMinor).trim();
  if (!MONEY_PATTERN.test(value)) {
    return invalid('INVALID_MONEY', 'manualUnitPriceMinor must be a non-negative integer minor-unit amount');
  }
  const reason = String(payload?.manualReason ?? '').trim();
  if (!reason || reason.length > 500) {
    return invalid('MANUAL_REASON_REQUIRED', 'manualReason is required and must not exceed 500 characters');
  }
  return { ok: true, supplied: true, value, reason };
}

export async function resolvePrice(client, { installationId, payload }) {
  const manual = manualValue(payload);
  if (!manual.ok) return manual;

  const automaticPayload = { ...payload };
  delete automaticPayload.manualUnitPriceMinor;
  delete automaticPayload.manualReason;
  delete automaticPayload.allowMissingBasePrice;

  const automatic = await legacy.resolvePrice(client, {
    installationId,
    payload: automaticPayload,
  });
  if (!automatic.ok) {
    if (automatic.code === 'BASE_PRICE_NOT_FOUND' && payload?.allowMissingBasePrice === true) {
      return {
        ok: true,
        resolution: {
          resolutionStatus: 'MANUAL_PRICE_REQUIRED',
          code: automatic.code,
          message: 'Chưa có giá Công Ty. Nhập giá bán theo quyền được cấp để tiếp tục.',
        },
      };
    }
    return automatic;
  }

  const systemResolution = {
    ...automatic.resolution,
    channelId: automatic.resolution.channelId ?? automaticPayload.channelId ?? null,
    customerId: automatic.resolution.customerId ?? automaticPayload.customerId ?? null,
    customerGroupId: automatic.resolution.customerGroupId ?? null,
    systemUnitPriceMinor: automatic.resolution.finalUnitPriceMinor,
  };
  const resolutionFingerprint = canonicalPricingFingerprint(systemResolution);

  if (!manual.supplied) {
    return {
      ok: true,
      resolution: {
        ...systemResolution,
        resolutionFingerprint,
      },
    };
  }

  const quantity = parseScaledDecimal(systemResolution.quantity, { allowZero: false });
  if (quantity === null) return invalid('INVALID_QUANTITY', 'quantity must be greater than zero');
  const final = BigInt(manual.value);
  const steps = [
    ...systemResolution.steps,
    {
      kind: 'MANUAL_OVERRIDE',
      reason: manual.reason,
      beforeUnitPriceMinor: systemResolution.systemUnitPriceMinor,
      afterUnitPriceMinor: manual.value,
    },
  ];

  return {
    ok: true,
    resolution: {
      ...systemResolution,
      finalUnitPriceMinor: manual.value,
      lineTotalMinor: halfUp(quantity * final, SCALE).toString(),
      steps,
      resolutionFingerprint,
    },
  };
}
