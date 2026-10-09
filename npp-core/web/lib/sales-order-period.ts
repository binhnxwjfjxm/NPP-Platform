// Calendar boundaries are explicit UTC instants for Viet Nam (UTC+7).
export function getVietnamMonthKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  if (!year || !month) throw new Error('Không xác định được tháng hiện tại');
  return `${year}-${month}`;
}

export function vietnamMonthBounds(key: string): { dateFrom: string; dateTo: string } {
  if (!/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(key)) throw new Error('Tháng cần xem không hợp lệ');
  const [year, month] = key.split('-').map(Number);
  return {
    dateFrom: new Date(Date.UTC(year, month - 1, 1, -7)).toISOString(),
    dateTo: new Date(Date.UTC(year, month, 1, -7)).toISOString(),
  };
}

export function previousVietnamMonth(key: string): string {
  vietnamMonthBounds(key);
  const [year, month] = key.split('-').map(Number);
  const previousYear = month === 1 ? year - 1 : year;
  const previousMonth = month === 1 ? 12 : month - 1;
  return `${previousYear}-${String(previousMonth).padStart(2, '0')}`;
}
