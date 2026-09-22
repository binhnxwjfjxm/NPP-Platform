import OvertimeCloseoutWorkspace from './overtime-closeout-workspace';

export const dynamic = 'force-dynamic';

function currentMonthBounds() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  const year = Number(parts.year);
  const month = Number(parts.month);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    from: `${year}-${String(month).padStart(2, '0')}-01`,
    to: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    today: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export default function OvertimeCloseoutPage() {
  const period = currentMonthBounds();
  return <OvertimeCloseoutWorkspace initialFrom={period.from} initialTo={period.to} initialToday={period.today} />;
}
