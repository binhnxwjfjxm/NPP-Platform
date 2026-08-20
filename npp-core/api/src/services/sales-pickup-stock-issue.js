import { issueDirectSalesOrderStock } from './sales-direct-stock-issue.js';

export function issuePickupSalesOrderStock(client, args) {
  return issueDirectSalesOrderStock(client, { ...args, mode: 'PICKUP' });
}
