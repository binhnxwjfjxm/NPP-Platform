import {
  decimalToScaled,
  mapCollection,
  mapHandover,
  normalizeCollectionPayload,
  payloadHash,
  scaledToDecimal,
} from './cod-settlement-shared.js';
import { normalizeHandoverPayload } from './cod-settlement-driver.js';

export {
  getDriverCodOverview,
  recordCodCollection,
  createCodHandover,
} from './cod-settlement-driver.js';
export {
  listCodHandovers,
  getCodHandover,
  acceptCodHandover,
  reverseCodCollection,
  reverseCodHandover,
  reverseCodAcceptance,
} from './cod-settlement-reconciliation.js';

export const codSettlementInternals = Object.freeze({
  decimalToScaled,
  scaledToDecimal,
  payloadHash,
  normalizeCollectionPayload,
  normalizeHandoverPayload,
  mapCollection,
  mapHandover,
});
