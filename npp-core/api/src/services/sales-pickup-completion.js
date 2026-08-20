import {
  completeDirectSalesOrder,
  settleDirectSalesOrder,
} from './sales-manual-completion.js';

export function completePickupSalesOrder(client, args) {
  return completeDirectSalesOrder(client, { ...args, mode: 'PICKUP' });
}

export function settlePickupSalesOrder(client, args) {
  return settleDirectSalesOrder(client, { ...args, mode: 'PICKUP' });
}
