export function confirmSingleStockIssue(orderNumber: string | null | undefined): boolean {
  const target = orderNumber ? `đơn ${orderNumber}` : 'đơn này';
  return window.confirm(`Xác nhận xuất kho ${target}?`);
}

export function confirmBulkStockIssue(count: number): boolean {
  return window.confirm(`Xác nhận xuất kho ${count.toLocaleString('vi-VN')} đơn Giao thủ công?`);
}
