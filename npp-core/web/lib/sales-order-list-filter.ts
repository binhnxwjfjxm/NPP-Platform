import type { SalesOrder } from './sales-order-types';

type Order = Pick<SalesOrder, 'number' | 'customerName' | 'customerCode' | 'sourceType' | 'sourceId' | 'deliveryMode' | 'deliveryExecutionMode'>;

export function normalizedOrderWords(value: string): string {
  return value.toLocaleLowerCase('vi-VN').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
}

export function matchesSalesOrderSearch(order: Order, search: string): boolean {
  const words = normalizedOrderWords(search.trim()).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const code = String(order.number ?? '');
  const compact = code.replace(/^SO-\d{6}-(\d{6})$/i, 'SO$1');
  const text = normalizedOrderWords([
    code, compact, order.customerName, order.customerCode, order.sourceId ?? '',
  ].join(' '));
  return words.every((word) => text.includes(word));
}

export function matchesSalesOrderSource(order: Order, source: 'all' | 'internal' | 'mcp' | 'customer'): boolean {
  if (source === 'all') return true;
  if (source === 'mcp') return order.sourceType === 'MCP';
  const customer = order.sourceType === 'API' && (order.sourceId ?? '').startsWith('CUSTOMER_PORTAL:');
  return source === 'customer' ? customer : order.sourceType !== 'MCP' && !customer;
}

export function matchesSalesOrderLane(order: Order, lane: 'all' | 'counter' | 'manual' | 'trip'): boolean {
  if (lane === 'all') return true;
  if (order.deliveryMode === 'PICKUP') return lane === 'counter';
  return lane === (order.deliveryExecutionMode === 'MANUAL' ? 'manual' : 'trip');
}
