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
function direction(value: string) { return value === 'IMPORT' ? 'Nhập dữ liệu' : value === 'EXPORT' ? 'Xuất dữ liệu' : 'Xử lý dữ liệu'; }
function status(value: string) { return ({ queued: 'Đang chờ', running: 'Đang xử lý', completed: 'Hoàn tất', failed: 'Thất bại', cancelled: 'Đã hủy' } as Record<string, string>)[value] ?? 'Trạng thái khác'; }
function definitionLabel(value: string): string {
  const key = value.toLowerCase().replace(/_/g, '-');
  const labels: Record<string, string> = {
    products: 'Sản phẩm', product: 'Sản phẩm',
    customers: 'Khách hàng', customer: 'Khách hàng',
    suppliers: 'Nhà cung cấp', supplier: 'Nhà cung cấp',
    'product-categories': 'Loại sản phẩm', 'product-brands': 'Nhãn hàng',
    inventory: 'Tồn kho', warehouses: 'Kho hàng',
    'sales-orders': 'Đơn bán hàng', 'purchase-orders': 'Đơn mua hàng',
    pricing: 'Giá bán', receivables: 'Công nợ khách hàng',
  };
  return labels[key] ?? 'Dữ liệu nghiệp vụ';
}
function sourceLabel(value: string): string {
  const source = value.toLowerCase();
  if (source.includes('mcp')) return 'Ứng dụng nhân viên thị trường';
  if (source.includes('delivery')) return 'Ứng dụng giao hàng';
  if (source.includes('admin')) return 'Ứng dụng quản trị';
  if (source.includes('web') || source.includes('npp') || source.includes('core')) return 'Hệ thống điều hành';
  return 'Hệ thống nội bộ';
}

export default async function ImportExportHistoryPage({ searchParams }: { searchParams?: Search }) {
  const params = {
    from: pick(searchParams, 'from') || undefined,
    to: pick(searchParams, 'to') || undefined,
    direction: pick(searchParams, 'direction') || undefined,
    status: pick(searchParams, 'status') || undefined,
    definitionKey: pick(searchParams, 'definitionKey') || undefined,
    cursor: pick(searchParams, 'cursor') || undefined,
  };
  const result = await getImportExportHistory(params).then((data) => ({ data, error: null as string | null })).catch((error: unknown) => ({ data: null, error: error instanceof Error ? error.message : 'Không tải được lịch sử nhập/xuất dữ liệu' }));

  return (
    <AppShell
      kicker="Lịch sử vận hành"
      title="Lịch sử nhập/xuất dữ liệu"
      subtitle="Theo dõi các lần nhập và xuất dữ liệu, người thực hiện, trạng thái và số dòng đã xử lý."
      actions={<div className={styles.actions}><Link className={styles.secondary} href="/operations/data-exchange">Nhập/xuất dữ liệu và báo giá</Link><Link className={styles.secondary} href="/operations/audit-history">Lịch sử thay đổi</Link></div>}
    >
      <form className={styles.toolbar} method="get">
        <label className={styles.field}>Từ ngày<input name="from" type="date" defaultValue={params.from ?? ''} /></label>
        <label className={styles.field}>Đến ngày<input name="to" type="date" defaultValue={params.to ?? ''} /></label>
        <label className={styles.field}>Loại thao tác<select name="direction" defaultValue={params.direction ?? ''}><option value="">Tất cả</option><option value="IMPORT">Nhập dữ liệu</option><option value="EXPORT">Xuất dữ liệu</option></select></label>
        <label className={styles.field}>Trạng thái<select name="status" defaultValue={params.status ?? ''}><option value="">Tất cả</option><option value="queued">Đang chờ</option><option value="running">Đang xử lý</option><option value="completed">Hoàn tất</option><option value="failed">Thất bại</option><option value="cancelled">Đã hủy</option></select></label>
        <div className={styles.actions}><button className={styles.button} type="submit">Lọc lịch sử</button><Link className={styles.secondary} href="/operations/import-export-history">Xóa lọc</Link></div>
      </form>

      {result.error ? <p className={styles.error} role="alert">{result.error}</p> : (
        <section className={styles.card} aria-label="Lịch sử nhập xuất dữ liệu">
          {result.data?.rows.length ? <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>Thời gian</th><th>Loại thao tác</th><th>Nhóm dữ liệu</th><th>Trạng thái</th><th>Người thực hiện</th><th>Kết quả</th></tr></thead>
            <tbody>{result.data.rows.map((row) => <tr key={row.jobId}>
              <td>{time(row.requestedAt)}<span className={styles.muted}>{String(row.format).toUpperCase()}</span></td>
              <td><span className={styles.primary}>{direction(row.direction)}</span></td>
              <td><span className={styles.primary}>{definitionLabel(row.definitionKey)}</span></td>
              <td><span className={styles.primary}>{status(row.status)}</span><span className={styles.muted}>Hoàn tất: {time(row.completedAt)}</span></td>
              <td><span className={styles.primary}>{row.employeeId ? 'Nhân viên nội bộ' : 'Tài khoản hệ thống'}</span><span className={styles.muted}>{sourceLabel(row.sourceApp)}</span></td>
              <td>
                {row.rowCount == null ? 'Chưa có số liệu' : `${row.rowCount} dòng`}
                <span className={styles.muted}>{row.failureCode ? 'Có lỗi cần xử lý' : row.hasResult ? 'Có kết quả' : 'Chưa có kết quả'}</span>
                <details>
                  <summary>Thông tin kỹ thuật</summary>
                  <span className={styles.muted}>Mã tác vụ: {row.jobId}</span>
                  <span className={styles.muted}>Mã truy vết: {row.requestId}</span>
                  <span className={styles.muted}>Nhóm dữ liệu hệ thống: {row.definitionKey}</span>
                  <span className={styles.muted}>Phiên bản cấu hình: {row.definitionVersion}</span>
                  <span className={styles.muted}>Mã người thực hiện: {row.actorId}</span>
                  <span className={styles.muted}>Nguồn hệ thống: {row.sourceApp}</span>
                  {row.failureCode ? <span className={styles.muted}>Mã lỗi: {row.failureCode}</span> : null}
                </details>
              </td>
            </tr>)}</tbody>
          </table></div> : <p className={styles.empty}>Chưa có lần nhập/xuất nào trong phạm vi lọc.</p>}
          {result.data?.page.hasMore && result.data.page.nextCursor ? <div className={styles.pager}><Link className={styles.secondary} href={nextHref(searchParams, result.data.page.nextCursor)}>Trang tiếp</Link></div> : null}
        </section>
      )}
    </AppShell>
  );
}
