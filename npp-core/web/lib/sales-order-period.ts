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

/** Both dates inclusive by Vietnamese calendar day; the upper bound is exclusive UTC. */
export function vietnamDateRangeBounds(from: string, to: string): { dateFrom: string; dateTo: string } {
  function parse(value: string): Date {
    if (!/^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(value)) {
      throw new Error('Vui lòng chọn đủ Từ ngày và Đến ngày.');
    }
    const date = new Date(value + 'T00:00:00.000Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new Error('Ngày chọn không hợp lệ.');
    }
    return date;
  }
  const start = parse(from);
  const end = parse(to);
  if (end < start) throw new Error('Đến ngày phải bằng hoặc sau Từ ngày.');
  if (end.getTime() - start.getTime() >= 366 * 86400000) {
    throw new Error('Mỗi lần xem tối đa 12 tháng. Để tìm đơn cũ, hãy dùng Tìm toàn bộ lịch sử.');
  }
  return {
    dateFrom: new Date(start.getTime() - 7 * 3600000).toISOString(),
    dateTo: new Date(end.getTime() + 86400000 - 7 * 3600000).toISOString(),
  };
}

export function getVietnamDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return part('year') + '-' + part('month') + '-' + part('day');
}
