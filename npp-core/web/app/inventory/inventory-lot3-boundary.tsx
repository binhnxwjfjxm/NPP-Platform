'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';

type Scope = 'balances' | 'tracking-policies' | 'lots' | 'opening-balances';
type PreviewRow = Record<string, string>;

type Props = { scope: Scope; children: ReactNode };

const TEMPLATE_HEADERS = [
  'warehouseId', 'locationId', 'sourceVariantId', 'sourceQuantity', 'lotCode',
  'manufacturedDate', 'expiryDate', 'supplierLotReference', 'sourceLineReference',
];

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      cells.push(value.trim()); value = '';
    } else value += character;
  }
  cells.push(value.trim());
  return cells;
}

function parseCsv(text: string): PreviewRow[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header.trim(), cells[index] ?? '']));
  });
}

function toApiRows(rows: PreviewRow[]) {
  return rows.map((row, index) => ({
    warehouseId: row.warehouseId,
    locationId: row.locationId || null,
    sourceVariantId: row.sourceVariantId,
    sourceQuantity: row.sourceQuantity,
    lotCode: row.lotCode || null,
    manufacturedDate: row.manufacturedDate || null,
    expiryDate: row.expiryDate || null,
    supplierLotReference: row.supplierLotReference || null,
    sourceLineReference: row.sourceLineReference || `Dong-${index + 2}`,
    metadata: {},
  }));
}

function setReactValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function downloadTemplate() {
  const example = [
    TEMPLATE_HEADERS.join(','),
    'WAREHOUSE_UUID,,VARIANT_UUID,10.000000,LO-001,2026-01-01,2027-01-01,,Dong-2',
  ].join('\n');
  const blob = new Blob([`\uFEFF${example}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'mau-ton-dau-ky.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function InventoryLot3Boundary({ scope, children }: Props) {
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);

  const invalidRows = useMemo(() => rows.filter((row) => !row.warehouseId || !row.sourceVariantId || !row.sourceQuantity), [rows]);

  useEffect(() => {
    if (scope !== 'opening-balances') return;
    const metadata = document.querySelector<HTMLTextAreaElement>('[data-testid="inventory-opening-metadata-input"]');
    const rawRows = document.querySelector<HTMLTextAreaElement>('[data-testid="inventory-opening-rows-input"]');
    metadata?.closest('label')?.setAttribute('hidden', 'true');
    rawRows?.closest('label')?.setAttribute('hidden', 'true');
  }, [scope]);

  useEffect(() => {
    if (scope !== 'tracking-policies') return;
    const lotSelect = document.querySelector<HTMLSelectElement>('[data-testid="inventory-policy-lot-mode-select"]');
    const expirySelect = document.querySelector<HTMLSelectElement>('[data-testid="inventory-policy-expiry-mode-select"]');
    if (lotSelect) {
      lotSelect.options[0].text = 'Không quản lý theo lô';
      lotSelect.options[1].text = 'Bắt buộc quản lý theo lô';
      lotSelect.insertAdjacentHTML('afterend', '<small>Chọn bắt buộc khi hàng hóa cần truy vết theo từng lô.</small>');
    }
    if (expirySelect) {
      expirySelect.options[0].text = 'Không quản lý hạn sử dụng';
      expirySelect.options[1].text = 'Có thể nhập hạn sử dụng';
      expirySelect.options[2].text = 'Bắt buộc nhập hạn sử dụng';
      expirySelect.insertAdjacentHTML('afterend', '<small>Hạn sử dụng chỉ được yêu cầu khi chính sách lô của SKU hỗ trợ.</small>');
    }
  }, [scope]);

  async function handleFile(file: File) {
    setFileError(null);
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setRows([]);
      setFileError('Hiện hệ thống nhận tệp CSV UTF-8. Trong Excel, chọn “Lưu thành CSV UTF-8” rồi tải lên.');
      return;
    }
    const parsed = parseCsv(await file.text());
    setFileName(file.name);
    setRows(parsed);
    const rowInput = document.querySelector<HTMLTextAreaElement>('[data-testid="inventory-opening-rows-input"]');
    const metadataInput = document.querySelector<HTMLTextAreaElement>('[data-testid="inventory-opening-metadata-input"]');
    const filenameInput = document.querySelector<HTMLInputElement>('[data-testid="inventory-opening-source-filename-input"]');
    if (rowInput) setReactValue(rowInput, JSON.stringify(toApiRows(parsed)));
    if (metadataInput) setReactValue(metadataInput, JSON.stringify({ importMethod: 'csv-upload', originalFilename: file.name }));
    if (filenameInput) setReactValue(filenameInput, file.name);
  }

  return (
    <div data-lot3-inventory-scope={scope}>
      {scope === 'opening-balances' ? (
        <section className="lot3ImportPanel" aria-label="Nhập tệp tồn đầu kỳ">
          <div>
            <h2>Nhập tệp tồn đầu kỳ</h2>
            <p>Tải tệp mẫu, điền bằng Excel rồi lưu dưới dạng CSV UTF-8. Hệ thống sẽ xem trước và báo dòng lỗi trước khi ghi nhận.</p>
          </div>
          <div className="lot3ImportActions">
            <button type="button" onClick={downloadTemplate}>Tải tệp mẫu CSV</button>
            <label>
              Chọn tệp Excel/CSV
              <input type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleFile(file); }} />
            </label>
          </div>
          {fileError ? <p role="alert" className="lot3ImportError">{fileError}</p> : null}
          {rows.length ? (
            <div className="lot3Preview">
              <p><strong>{fileName}</strong> · {rows.length} dòng · {invalidRows.length ? `${invalidRows.length} dòng thiếu dữ liệu bắt buộc` : 'Sẵn sàng kiểm tra'}</p>
              <div className="lot3PreviewTable"><table><thead><tr><th>Dòng</th><th>Kho</th><th>SKU</th><th>Số lượng</th><th>Lô</th><th>Trạng thái</th></tr></thead><tbody>
                {rows.slice(0, 20).map((row, index) => <tr key={index}><td>{index + 2}</td><td>{row.warehouseId || '—'}</td><td>{row.sourceVariantId || '—'}</td><td>{row.sourceQuantity || '—'}</td><td>{row.lotCode || '—'}</td><td>{!row.warehouseId || !row.sourceVariantId || !row.sourceQuantity ? 'Thiếu dữ liệu' : 'Hợp lệ sơ bộ'}</td></tr>)}
              </tbody></table></div>
            </div>
          ) : null}
        </section>
      ) : null}
      {children}
    </div>
  );
}
