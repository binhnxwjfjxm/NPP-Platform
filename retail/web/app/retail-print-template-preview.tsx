'use client';

import type { CSSProperties } from 'react';
import type { PrinterPaper } from '../lib/printer-bridge';

const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });

const SAMPLE_LINES = [
  { name: 'Siro Mama Cam', sku: 'SIROMC', quantity: '2', unit: 'CHAI', unitPrice: 68000, total: 136000 },
  { name: 'Bột kem pha chế', sku: 'BOTKEM', quantity: '1', unit: 'BỊCH', unitPrice: 125000, total: 125000 },
];

function paperClass(paper: PrinterPaper) {
  return paper === 'A4' ? 'a4' : paper === 'A5' ? 'a5' : paper === '80mm' ? '80' : '58';
}

function fontStyle(paper: PrinterPaper, percent: number): CSSProperties {
  const safePercent = Number.isInteger(percent) ? Math.max(80, Math.min(140, percent)) : 100;
  const basePx = paper === '80mm' || paper === '58mm' ? 10 : 12;
  return { fontSize: `${basePx * safePercent / 100}px` };
}

export function RetailPrintTemplatePreview({
  paper,
  visibleFieldKeys,
  heading,
  title,
  subtitle,
  fallbackTitle,
  fontSizePercent,
}: {
  paper: PrinterPaper;
  visibleFieldKeys: string[];
  heading: string;
  title: string;
  subtitle: string;
  fallbackTitle: string;
  fontSizePercent: number;
}) {
  const visible = new Set(visibleFieldKeys);
  const total = SAMPLE_LINES.reduce((sum, line) => sum + line.total, 0);

  return (
    <section className="template-live-preview" aria-label="Xem trước mẫu phiếu thực tế">
      <header>
        <div>
          <strong>Xem trước thực tế</strong>
          <small>{paper} · dữ liệu mẫu</small>
        </div>
        <span>{fontSizePercent}%</span>
      </header>
      <div className={`template-preview-stage paper-${paperClass(paper)}`}>
        <article className="print-document" style={fontStyle(paper, fontSizePercent)}>
          <header>
            {heading.trim() ? <p>{heading.trim()}</p> : null}
            <h1>{title.trim() || fallbackTitle}</h1>
            {subtitle.trim() ? <p>{subtitle.trim()}</p> : null}
            <small>SO-000123</small>
          </header>
          <div className="print-meta">
            {visible.has('customer') ? <p><span>Khách hàng</span><strong>Khách lẻ</strong></p> : null}
            {visible.has('warehouse') ? <p><span>Kho bán</span><strong>Kho Công Ty</strong></p> : null}
            {visible.has('document_date') ? <p><span>Ngày</span><strong>16/09/2026 17:30</strong></p> : null}
          </div>
          {visible.has('line_item') ? <table>
            <thead><tr>
              {visible.has('line_no') ? <th>STT</th> : null}
              <th>Sản phẩm</th>
              {visible.has('line_quantity') ? <th>SL</th> : null}
              <th>ĐVT</th>
              {visible.has('line_unit_price') ? <th>Đơn giá</th> : null}
              {visible.has('line_total') ? <th>Thành tiền</th> : null}
            </tr></thead>
            <tbody>{SAMPLE_LINES.map((line, index) => <tr key={line.sku}>
              {visible.has('line_no') ? <td>{index + 1}</td> : null}
              <td><strong>{line.name}</strong>{visible.has('line_sku') ? <small>{line.sku}</small> : null}</td>
              {visible.has('line_quantity') ? <td>{line.quantity}</td> : null}
              <td>{line.unit}</td>
              {visible.has('line_unit_price') ? <td>{money.format(line.unitPrice)}</td> : null}
              {visible.has('line_total') ? <td>{money.format(line.total)}</td> : null}
            </tr>)}</tbody>
          </table> : null}
          <footer>
            {visible.has('total_total') ? <p className="print-grand-total"><span>Tổng cộng</span><strong>{money.format(total)}</strong></p> : null}
            {visible.has('note') ? <p className="print-note"><span>Ghi chú</span><strong>Giao tại quầy</strong></p> : null}
            {visible.has('signatures') ? <div className="print-signatures"><span>Người lập</span><span>Khách hàng</span></div> : null}
          </footer>
        </article>
      </div>
    </section>
  );
}
