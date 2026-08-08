import Link from 'next/link';
import { AppShell } from '../../components/app-shell-core';
import { getImportExportHistory } from '../../../lib/operations-history-gateway';
import styles from '../operations-history.module.css';

export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
function pick(search: Search | undefined, key: string): string { const value = search?.[key]; return Array.isArray(value) ? value[0] ?? '' : value ?? ''; }
function nextHref(search: Search | undefined, cursor: string): string {
  const params = new URLSearchParams();
  for (const key of ['from', 'to', 'direction', 'status', 'definitionKey']) { const value = pick(search, key); if (value) params.set(key, value); }
  params.set('cursor', cursor);
  return `/operations/import-export-history?${params}`;
}
function time(value: string | null): string { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Ho_Chi_Minh' }).format(date); }

export default async function ImportExportHistoryPage({ searchParams }: { searchParams?: Search }) {
  const params = {
    from: pick(searchParams, 'from') || undefined,
    to: pick(searchParams, 'to') || undefined,
    direction: pick(searchParams, 'direction') || undefined,
    status: pick(searchParams, 'status') || undefined,
    definitionKey: pick(searchParams, 'definitionKey') || undefined,
    cursor: pick(searchParams, 'cursor') || undefined,
  };
  const result = await getImportExportHistory(params).then((data) => ({ data, error: null as string | null })).catch((error: unknown) => ({ data: null, error: error instanceof Error ? error.message : 'Không tải được lịch sử import/export' }));

  return (
    <AppShell
      kicker="Phase 8.7 · Lịch sử vận hành"
      title="Import / Export history"
      subtitle="Metadata job canonical của Core. Download CSV cũ ở browser/MCP không được giả thành lịch sử chính thức."
      actions={<Link className={styles.secondary} href="/operations/audit-history">Audit & hoạt động</Link>}
    >
      <form className={styles.toolbar} method="get">
        <label className={styles.field}>Từ ngày<input name="from" type="date" defaultValue={params.from ?? ''} /></label>
        <label className={styles.field}>Đến ngày<input name="to" type="date" defaultValue={params.to ?? ''} /></label>
        <label className={styles.field}>Chiều<select name="direction" defaultValue={params.direction ?? ''}><option value="">Tất cả</option><option value="IMPORT">Import</option><option value="EXPORT">Export</option></select></label>
        <label className={styles.field}>Trạng thái<select name="status" defaultValue={params.status ?? ''}><option value="">Tất cả</option><option value="queued">Queued</option><option value="running">Running</option><option value="completed">Completed</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option></select></label>
        <label className={styles.field}>Định nghĩa<input name="definitionKey" defaultValue={params.definitionKey ?? ''} placeholder="sales.summary" /></label>
        <div className={styles.actions}><button className={styles.button} type="submit">Lọc lịch sử</button><Link className={styles.secondary} href="/operations/import-export-history">Xóa lọc</Link></div>
      </form>

      {result.error ? <p className={styles.error} role="alert">{result.error}</p> : (
        <section className={styles.card} aria-label="Lịch sử import export">
          {result.data?.rows.length ? <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>Yêu cầu</th><th>Job</th><th>Định nghĩa</th><th>Trạng thái</th><th>Người thực hiện</th><th>Kết quả</th></tr></thead>
            <tbody>{result.data.rows.map((row) => <tr key={row.jobId}>
              <td>{time(row.requestedAt)}<span className={styles.muted}>{row.direction} · {row.format}</span></td>
              <td><span className={styles.primary}>{row.jobId}</span><span className={styles.muted}>{row.requestId}</span></td>
              <td><span className={styles.primary}>{row.definitionKey}</span><span className={styles.muted}>v{row.definitionVersion}</span></td>
              <td><span className={styles.primary}>{row.status}</span><span className={styles.muted}>Xong: {time(row.completedAt)}</span></td>
              <td><span className={styles.primary}>{row.actorId}</span><span className={styles.muted}>{row.sourceApp}</span></td>
              <td>{row.rowCount ?? '—'} dòng<span className={styles.muted}>{row.failureCode || (row.hasResult ? 'Có kết quả canonical' : 'Chưa có artifact')}</span></td>
            </tr>)}</tbody>
          </table></div> : <p className={styles.empty}>Chưa có job import/export canonical trong phạm vi lọc.</p>}
          {result.data?.page.hasMore && result.data.page.nextCursor ? <div className={styles.pager}><Link className={styles.secondary} href={nextHref(searchParams, result.data.page.nextCursor)}>Trang tiếp</Link></div> : null}
        </section>
      )}
    </AppShell>
  );
}
