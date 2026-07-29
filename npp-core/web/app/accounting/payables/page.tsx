import Link from 'next/link';
import { AppShell } from '../../components/app-shell';
import { getPayable, listPayableBalances, listPayables, resolvePayableRequestId } from '../../../lib/payable-gateway';
import type { PayableDocument, SupplierPayableBalance } from '../../../lib/payable-types';
import styles from './payables.module.css';

export const dynamic = 'force-dynamic';
type PageProps = { searchParams?: Record<string,string | string[] | undefined> };
function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }
function money(value: string, currencyCode='VND') {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return `${value} ${currencyCode}`;
  return new Intl.NumberFormat('vi-VN',{ style:'currency',currency:currencyCode,minimumFractionDigits:currencyCode==='VND'?0:2,maximumFractionDigits:6 }).format(numeric);
}
function statusLabel(status: PayableDocument['status']) {
  return { open:'Còn mở',partially_allocated:'Đã phân bổ một phần',settled:'Đã tất toán',reversed:'Đã đảo' }[status];
}

export default async function PayablesPage({ searchParams }: PageProps) {
  const requestId = resolvePayableRequestId(null);
  const selectedId = first(searchParams?.id);
  const [documentsResult,balancesResult,detailResult] = await Promise.allSettled([
    listPayables<PayableDocument>(requestId,{ limit:1000 }),
    listPayableBalances<SupplierPayableBalance>(requestId,{ limit:1000 }),
    selectedId ? getPayable<PayableDocument>(selectedId,requestId) : Promise.resolve(null),
  ]);
  const documents = documentsResult.status==='fulfilled' ? documentsResult.value : [];
  const balances = balancesResult.status==='fulfilled' ? balancesResult.value : [];
  const detail = detailResult.status==='fulfilled' ? detailResult.value : null;
  const error = documentsResult.status==='rejected' || balancesResult.status==='rejected'
    ? 'Không tải được đầy đủ dữ liệu công nợ phải trả. Hãy thử tải lại trang.'
    : detailResult.status==='rejected' ? 'Không tải được chi tiết chứng từ công nợ đã chọn.' : null;
  const vndBalances = balances.filter((item)=>item.currencyCode==='VND');
  const totalBalance = vndBalances.reduce((sum,item)=>sum+Number(item.balance||0),0);
  const totalOverdue = vndBalances.reduce((sum,item)=>sum+Number(item.overdueAmount||0),0);
  const openDocuments = documents.filter((item)=>item.status==='open'||item.status==='partially_allocated').length;

  return (
    <AppShell title="Công nợ phải trả" subtitle="Đối chiếu công nợ phát sinh tự động từ phiếu nhận hàng và phiếu trả nhà cung cấp." kicker="Kế toán mua hàng">
      <div className={styles.grid} data-testid="payables-page">
        {error ? <div className={styles.alert} role="alert">{error}</div> : null}
        <section className={styles.summaryGrid} aria-label="Tổng hợp công nợ">
          <article className={styles.card}><span className={styles.muted}>Số dư phải trả (VND)</span><p className={styles.value} data-testid="payable-total-balance">{money(String(totalBalance))}</p></article>
          <article className={styles.card}><span className={styles.muted}>Đã quá hạn (VND)</span><p className={styles.value}>{money(String(totalOverdue))}</p></article>
          <article className={styles.card}><span className={styles.muted}>Chứng từ còn mở</span><p className={styles.value}>{openDocuments}</p></article>
        </section>

        <section className={styles.card}>
          <h2>Số dư theo nhà cung cấp</h2>
          <div className={styles.tableWrap}><table className={styles.table} data-testid="payable-balances-table">
            <thead><tr><th>Nhà cung cấp</th><th>Tiền tệ</th><th className={styles.amount}>Số dư</th><th className={styles.amount}>Còn mở</th><th className={styles.amount}>Quá hạn</th></tr></thead>
            <tbody>{balances.map((item)=><tr key={`${item.supplierId}-${item.currencyCode}`}><td><strong>{item.supplierCode}</strong><br/><span className={styles.muted}>{item.supplierName}</span></td><td>{item.currencyCode}</td><td className={styles.amount}>{money(item.balance,item.currencyCode)}</td><td className={styles.amount}>{money(item.openAmount,item.currencyCode)}</td><td className={styles.amount}>{money(item.overdueAmount,item.currencyCode)}</td></tr>)}{!balances.length?<tr><td colSpan={5} className={styles.muted}>Chưa có số dư công nợ.</td></tr>:null}</tbody>
          </table></div>
        </section>

        <section className={styles.card}>
          <h2>Chứng từ công nợ</h2>
          <div className={styles.tableWrap}><table className={styles.table} data-testid="payables-table">
            <thead><tr><th>Chứng từ nguồn</th><th>Nhà cung cấp</th><th>Kho</th><th>Hạn thanh toán</th><th>Trạng thái</th><th className={styles.amount}>Giá trị</th></tr></thead>
            <tbody>{documents.map((item)=><tr key={item.id}><td><Link className={styles.link} href={`/accounting/payables?id=${item.id}`}>{item.sourceDocumentNumber}</Link><br/><span className={styles.muted}>{item.sourceDocumentDate}</span></td><td>{item.supplierCode}<br/><span className={styles.muted}>{item.supplierName}</span></td><td>{item.warehouseCode}<br/><span className={styles.muted}>{item.warehouseName}</span></td><td>{item.dueDate}<br/><span className={styles.muted}>{item.paymentMethod} · {item.paymentTermDays} ngày</span></td><td><span className={styles.badge}>{statusLabel(item.status)}</span></td><td className={`${styles.amount} ${item.direction==='DEBIT'?styles.debit:styles.credit}`}>{money(item.signedOriginalAmount,item.currencyCode)}</td></tr>)}{!documents.length?<tr><td colSpan={6} className={styles.muted}>Chưa phát sinh chứng từ công nợ.</td></tr>:null}</tbody>
          </table></div>
        </section>

        {detail ? <section className={styles.card} data-testid="payable-detail">
          <Link className={`${styles.link} ${styles.back}`} href="/accounting/payables">← Đóng chi tiết</Link><h2>{detail.sourceDocumentNumber}</h2>
          <div className={styles.detailGrid}>
            <div className={styles.detailItem}><span className={styles.muted}>Nhà cung cấp</span><strong>{detail.supplierCode} · {detail.supplierName}</strong></div>
            <div className={styles.detailItem}><span className={styles.muted}>Giá trị gốc</span><strong>{money(detail.signedOriginalAmount,detail.currencyCode)}</strong></div>
            <div className={styles.detailItem}><span className={styles.muted}>Còn lại</span><strong>{money(detail.remainingAmount,detail.currencyCode)}</strong></div>
            <div className={styles.detailItem}><span className={styles.muted}>Trạng thái</span><strong>{statusLabel(detail.status)}</strong></div>
          </div>
          <h3>Dòng chứng từ</h3><div className={styles.tableWrap}><table className={styles.table} data-testid="payable-lines-table"><thead><tr><th>SKU</th><th>Hàng hóa</th><th className={styles.amount}>Số lượng</th><th className={styles.amount}>Đơn giá</th><th className={styles.amount}>Thành tiền</th></tr></thead><tbody>{detail.lines.map((line)=><tr key={line.id}><td>{line.sku}</td><td>{line.itemName}</td><td className={styles.amount}>{line.quantity} {line.unitCode}</td><td className={styles.amount}>{money(line.unitPrice,detail.currencyCode)}</td><td className={styles.amount}>{money(line.lineAmount,detail.currencyCode)}</td></tr>)}</tbody></table></div>
          <h3>Sổ chi tiết</h3><div className={styles.tableWrap}><table className={styles.table} data-testid="payable-ledger-table"><thead><tr><th>Thời điểm</th><th>Loại bút toán</th><th>Yêu cầu</th><th className={styles.amount}>Số tiền</th></tr></thead><tbody>{detail.ledgerEntries.map((entry)=><tr key={entry.id}><td>{entry.occurredAt}</td><td>{entry.entryType}</td><td>{entry.requestId}</td><td className={styles.amount}>{money(entry.amount,detail.currencyCode)}</td></tr>)}</tbody></table></div>
        </section> : null}
      </div>
    </AppShell>
  );
}
