import Link from 'next/link';
import { AppShell } from '../../components/app-shell-core';
import { getAuditHistory } from '../../../lib/operations-history-gateway';
import styles from '../operations-history.module.css';

export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
function pick(search: Search | undefined, key: string): string { const value = search?.[key]; return Array.isArray(value) ? value[0] ?? '' : value ?? ''; }
function nextHref(search: Search | undefined, cursor: string): string {
  const params = new URLSearchParams();
  for (const key of ['from', 'to', 'action', 'resourceType', 'sourceApp']) { const value = pick(search, key); if (value) params.set(key, value); }
  params.set('cursor', cursor);
  return `/operations/audit-history?${params}`;
}
function time(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Ho_Chi_Minh' }).format(date); }

export default async function AuditHistoryPage({ searchParams }: { searchParams?: Search }) {
  const params = {
    from: pick(searchParams, 'from') || undefined,
    to: pick(searchParams, 'to') || undefined,
    action: pick(searchParams, 'action') || undefined,
    resourceType: pick(searchParams, 'resourceType') || undefined,
    sourceApp: pick(searchParams, 'sourceApp') || undefined,
    cursor: pick(searchParams, 'cursor') || undefined,
  };
  const result = await getAuditHistory(params).then((data) => ({ data, error: null as string | null })).catch((error: unknown) => ({ data: null, error: error instanceof Error ? error.message : 'Không tải được lịch sử audit' }));

  return (
    <AppShell
      kicker="Phase 8.7 · Lịch sử vận hành"
      title="Audit & hoạt động hệ thống"
      subtitle="Dòng thời gian append-only từ Core. Màn này chỉ đọc metadata truy vết; thao tác nghiệp vụ vẫn ở màn nguồn."
      actions={<Link className={styles.secondary} href="/operations/import-export-history">Lịch sử import/export</Link>}
    >
      <form className={styles.toolbar} method="get">
        <label className={styles.field}>Từ ngày<input name="from" type="date" defaultValue={params.from ?? ''} /></label>
        <label className={styles.field}>Đến ngày<input name="to" type="date" defaultValue={params.to ?? ''} /></label>
        <label className={styles.field}>Hành động<input name="action" defaultValue={params.action ?? ''} placeholder="sales.order.confirmed" /></label>
        <label className={styles.field}>Loại tài nguyên<input name="resourceType" defaultValue={params.resourceType ?? ''} placeholder="sales-order" /></label>
        <label className={styles.field}>Ứng dụng nguồn<input name="sourceApp" defaultValue={params.sourceApp ?? ''} placeholder="npp" /></label>
        <div className={styles.actions}><button className={styles.button} type="submit">Lọc lịch sử</button><Link className={styles.secondary} href="/operations/audit-history">Xóa lọc</Link></div>
      </form>

      {result.error ? <p className={styles.error} role="alert">{result.error}</p> : (
        <section className={styles.card} aria-label="Lịch sử audit">
          {result.data?.rows.length ? <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>Thời điểm</th><th>Hành động</th><th>Tài nguyên</th><th>Người thực hiện</th><th>Nguồn / request</th><th>Thay đổi</th></tr></thead>
            <tbody>{result.data.rows.map((row) => <tr key={row.auditId}>
              <td>{time(row.occurredAt)}</td>
              <td><span className={styles.primary}>{row.action}</span></td>
              <td><span className={styles.primary}>{row.resourceType}</span><span className={styles.muted}>{row.resourceId || '—'}</span></td>
              <td><span className={styles.primary}>{row.actorId}</span><span className={styles.muted}>{row.employeeId || 'Không gắn employee'}</span></td>
              <td><span className={styles.primary}>{row.sourceApp}</span><span className={styles.muted}>{row.requestId}</span></td>
              <td>{row.hasBeforeData || row.hasAfterData ? 'Có snapshot thay đổi' : 'Metadata only'}</td>
            </tr>)}</tbody>
          </table></div> : <p className={styles.empty}>Chưa có bản ghi audit trong phạm vi lọc.</p>}
          {result.data?.page.hasMore && result.data.page.nextCursor ? <div className={styles.pager}><Link className={styles.secondary} href={nextHref(searchParams, result.data.page.nextCursor)}>Trang tiếp</Link></div> : null}
        </section>
      )}
    </AppShell>
  );
}
