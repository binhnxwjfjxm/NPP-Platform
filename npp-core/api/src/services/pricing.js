import * as legacy from './pricing-legacy.js';
import {
  canonicalPricingFingerprint,
  halfUp,
  parseScaledDecimal,
} from './sales-order-commercial.js';

export * from './pricing-legacy.js';

const MONEY_PATTERN = /^(?:0|[1-9]\d{0,18})$/;
const SCALE = 1_000_000n;

function invalid(code, message, retryable = false) {
  return { ok: false, code, message, retryable };
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

  const automatic = await legacy.resolvePrice(client, {
    installationId,
    payload: automaticPayload,
  });
  if (!automatic.ok) return automatic;

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
