import {
  directStockIssueInternals,
  issueDirectSalesOrderStock,
} from './sales-direct-stock-issue.js';

export function issueManualSalesOrderStock(client, args) {
  return issueDirectSalesOrderStock(client, { ...args, mode: 'MANUAL' });
}

export const manualStockIssueInternals = directStockIssueInternals;
