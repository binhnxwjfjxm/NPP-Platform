'use client';

import { useState } from 'react';
import { exportTable } from '../operations/data-exchange/data-exchange-file-utils';
import styles from './operational-export-actions.module.css';

type Cell = string | number | boolean | null | undefined;

export type OperationalExportSheet = Readonly<{
  sheetName: string;
  headers: readonly string[];
  rows: readonly (readonly Cell[])[];
}>;

function filenameForFormat(filename: string, format: 'xlsx' | 'csv') {
  const base = filename.replace(/\.(xlsx|csv)$/i, '');
  return `${base}.${format}`;
}

function normalizedRows(rows: readonly (readonly Cell[])[]): string[][] {
  return rows.map((row) => row.map((value) => value === null || value === undefined ? '' : String(value)));
}

async function exportWorkbook(filename: string, sheets: readonly OperationalExportSheet[]) {
  const response = await fetch('/api/data-exchange/workbook-xlsx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sheets: sheets.map((sheet) => ({
        sheetName: sheet.sheetName,
        headers: [...sheet.headers],
        rows: sheet.rows.map((row) => [...row]),
      })),
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(payload?.error?.message || 'Không tạo được tệp Excel.');
  }
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filenameForFormat(filename, 'xlsx');
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

export default function OperationalExportActions({
  filename,
  sheets,
  allowCsv = false,
  disabled = false,
}: {
  filename: string;
  sheets: readonly OperationalExportSheet[];
  allowCsv?: boolean;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState<'xlsx' | 'csv' | null>(null);
  const [message, setMessage] = useState('');
  const rowCount = sheets.reduce((total, sheet) => total + sheet.rows.length, 0);
  const blocked = disabled || busy !== null || rowCount === 0;

  async function run(format: 'xlsx' | 'csv') {
    if (blocked) return;
    setBusy(format);
    setMessage('');
    try {
      if (format === 'csv') {
        if (sheets.length !== 1) throw new Error('CSV chỉ dùng cho danh sách một bảng.');
        const sheet = sheets[0];
        await exportTable(filenameForFormat(filename, 'csv'), sheet.sheetName, [...sheet.headers], normalizedRows(sheet.rows), 'csv');
      } else if (sheets.length === 1) {
        const sheet = sheets[0];
        await exportTable(filenameForFormat(filename, 'xlsx'), sheet.sheetName, [...sheet.headers], normalizedRows(sheet.rows), 'xlsx');
      } else {
        await exportWorkbook(filename, sheets);
      }
      setMessage(`Đã xuất ${rowCount.toLocaleString('vi-VN')} dòng.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không xuất được tệp.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.wrap} data-testid="operational-export-actions">
      <button type="button" className={styles.button} onClick={() => void run('xlsx')} disabled={blocked}>
        {busy === 'xlsx' ? 'Đang xuất…' : 'Xuất Excel'}
      </button>
      {allowCsv && sheets.length === 1 ? (
        <button type="button" className={styles.button} onClick={() => void run('csv')} disabled={blocked}>
          {busy === 'csv' ? 'Đang xuất…' : 'Xuất CSV'}
        </button>
      ) : null}
      {message ? <span className={styles.message} role="status">{message}</span> : null}
    </div>
  );
}
