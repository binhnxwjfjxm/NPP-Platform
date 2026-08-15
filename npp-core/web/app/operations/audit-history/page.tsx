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
function actionLabel(value: string): string {
  const action = value.toLowerCase();
  if (action.includes('create')) return 'Tạo mới';
  if (action.includes('confirm')) return 'Xác nhận';
  if (action.includes('cancel')) return 'Hủy';
  if (action.includes('delete') || action.includes('remove')) return 'Xóa';
  if (action.includes('activate')) return 'Đưa vào sử dụng';
  if (action.includes('deactivate') || action.includes('disable')) return 'Ngừng sử dụng';
  if (action.includes('import')) return 'Nhập dữ liệu';
  if (action.includes('export')) return 'Xuất dữ liệu';
  if (action.includes('update') || action.includes('change') || action.includes('edit')) return 'Cập nhật';
  return 'Thao tác hệ thống';
}
function resourceLabel(value: string): string {
  const resource = value.toLowerCase();
  if (resource.includes('customer')) return 'Khách hàng';
  if (resource.includes('supplier')) return 'Nhà cung cấp';
  if (resource.includes('product') || resource.includes('sku')) return 'Sản phẩm';
  if (resource.includes('sales') && resource.includes('order')) return 'Đơn bán hàng';
  if (resource.includes('purchase') && resource.includes('order')) return 'Đơn mua hàng';
  if (resource.includes('warehouse')) return 'Kho hàng';
  if (resource.includes('inventory')) return 'Tồn kho';
  if (resource.includes('payment') || resource.includes('receivable')) return 'Công nợ và thanh toán';
  if (resource.includes('role') || resource.includes('permission')) return 'Vai trò và phân quyền';
  if (resource.includes('user') || resource.includes('employee')) return 'Người dùng và nhân sự';
  return 'Dữ liệu nghiệp vụ';
}
function sourceLabel(value: string): string {
  const source = value.toLowerCase();
  if (source.includes('mcp')) return 'Ứng dụng nhân viên thị trường';
  if (source.includes('delivery')) return 'Ứng dụng giao hàng';
  if (source.includes('admin')) return 'Ứng dụng quản trị';
  if (source.includes('web') || source.includes('npp') || source.includes('core')) return 'Hệ thống điều hành';
  return 'Hệ thống nội bộ';
}

export default async function AuditHistoryPage({ searchParams }: { searchParams?: Search }) {
  const params = {
    from: pick(searchParams, 'from') || undefined,
    to: pick(searchParams, 'to') || undefined,
    action: pick(searchParams, 'action') || undefined,
    resourceType: pick(searchParams, 'resourceType') || undefined,
    sourceApp: pick(searchParams, 'sourceApp') || undefined,
    cursor: pick(searchParams, 'cursor') || undefined,
  };
  const result = await getAuditHistory(params).then((data) => ({ data, error: null as string | null })).catch((error: unknown) => ({ data: null, error: error instanceof Error ? error.message : 'Không tải được lịch sử thay đổi' }));

  return (
    <AppShell
      kicker="Lịch sử vận hành"
      title="Lịch sử thay đổi hệ thống"
      subtitle="Theo dõi dữ liệu nào đã thay đổi, thao tác gì được thực hiện và vào thời điểm nào."
      actions={<Link className={styles.secondary} href="/operations/import-export-history">Lịch sử nhập/xuất dữ liệu</Link>}
    >
      <form className={styles.toolbar} method="get">
        <label className={styles.field}>Từ ngày<input name="from" type="date" defaultValue={params.from ?? ''} /></label>
        <label className={styles.field}>Đến ngày<input name="to" type="date" defaultValue={params.to ?? ''} /></label>
        <div className={styles.actions}><button className={styles.button} type="submit">Lọc lịch sử</button><Link className={styles.secondary} href="/operations/audit-history">Xóa lọc</Link></div>
      </form>

      {result.error ? <p className={styles.error} role="alert">{result.error}</p> : (
        <section className={styles.card} aria-label="Lịch sử thay đổi hệ thống">
          {result.data?.rows.length ? <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>Thời điểm</th><th>Thao tác</th><th>Loại dữ liệu</th><th>Người thực hiện</th><th>Nguồn thao tác</th><th>Nội dung thay đổi</th></tr></thead>
            <tbody>{result.data.rows.map((row) => <tr key={row.auditId}>
              <td>{time(row.occurredAt)}</td>
              <td><span className={styles.primary}>{actionLabel(row.action)}</span></td>
              <td><span className={styles.primary}>{resourceLabel(row.resourceType)}</span></td>
              <td><span className={styles.primary}>{row.employeeId ? 'Nhân viên nội bộ' : 'Tài khoản hệ thống'}</span></td>
              <td><span className={styles.primary}>{sourceLabel(row.sourceApp)}</span></td>
              <td>
                <span className={styles.primary}>{row.hasBeforeData || row.hasAfterData ? 'Có nội dung thay đổi' : 'Ghi nhận thao tác'}</span>
                <details>
                  <summary>Thông tin kỹ thuật</summary>
                  <span className={styles.muted}>Mã thao tác: {row.action}</span>
                  <span className={styles.muted}>Loại dữ liệu: {row.resourceType}</span>
                  <span className={styles.muted}>Mã bản ghi: {row.resourceId || '—'}</span>
                  <span className={styles.muted}>Mã người thực hiện: {row.actorId}</span>
                  <span className={styles.muted}>Nguồn hệ thống: {row.sourceApp}</span>
                  <span className={styles.muted}>Mã truy vết: {row.requestId}</span>
                </details>
              </td>
            </tr>)}</tbody>
          </table></div> : <p className={styles.empty}>Chưa có thay đổi nào trong phạm vi lọc.</p>}
          {result.data?.page.hasMore && result.data.page.nextCursor ? <div className={styles.pager}><Link className={styles.secondary} href={nextHref(searchParams, result.data.page.nextCursor)}>Trang tiếp</Link></div> : null}
        </section>
      )}
    </AppShell>
  );
}
