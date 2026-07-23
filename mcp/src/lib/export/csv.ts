type CsvValue = string | number | boolean | null | undefined;

export type CsvColumn<T> = {
  key: string;
  header: string;
  value?: (row: T) => CsvValue;
};

function spreadsheetSafe(value: CsvValue) {
  const normalized = value == null ? "" : String(value).replace(/\r?\n/g, " ");
  return /^[=+\-@]/.test(normalized) ? `'${normalized}` : normalized;
}

function cell(value: CsvValue) {
  const text = spreadsheetSafe(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function csvResponse<T>(filename: string, columns: CsvColumn<T>[], rows: T[]) {
  const header = columns.map((column) => cell(column.header)).join(",");
  const body = rows.map((row) => columns.map((column) => cell(column.value ? column.value(row) : (row as Record<string, CsvValue>)[column.key])).join(","));
  const csv = `\ufeff${[header, ...body].join("\r\n")}`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export function yyyyMMdd() {
  return new Date().toISOString().slice(0, 10);
}
