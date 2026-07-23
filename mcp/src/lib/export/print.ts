import { reportDate, reportDateTime, reportMoney } from "@/lib/export/business-report";

type Cell = string | number | boolean | null | undefined;

type PrintPageSize = "A4" | "A5";
type PrintOrientation = "portrait" | "landscape";

export type PrintHtmlOptions = {
  pageSize?: PrintPageSize;
  orientation?: PrintOrientation;
  backHref?: string;
  backLabel?: string;
  downloadHref?: string;
  downloadLabel?: string;
  compact?: boolean;
};

export function text(value: Cell) {
  return value == null ? "" : String(value);
}

export function esc(value: Cell) {
  return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function money(value: Cell) {
  return reportMoney(value);
}

export function dateText(value: Cell) {
  return reportDate(value);
}

function internalHref(value: string | undefined, fallback: string) {
  const normalized = String(value || "").trim();
  return normalized.startsWith("/") && !normalized.startsWith("//") ? normalized : fallback;
}

export function printHtml(title: string, body: string, options: PrintHtmlOptions = {}) {
  const pageSize = options.pageSize || "A5";
  const orientation = options.orientation || "portrait";
  const pageWidth = pageSize === "A5"
    ? orientation === "landscape" ? "210mm" : "148mm"
    : orientation === "landscape" ? "297mm" : "210mm";
  const pageMargin = pageSize === "A5" ? "7mm" : "12mm";
  const backHref = internalHref(options.backHref, "/");
  const downloadHref = options.downloadHref ? internalHref(options.downloadHref, "") : "";
  const compactClass = options.compact ? " compact" : "";
  const downloadAction = downloadHref
    ? `<a class="btn secondary" href="${esc(downloadHref)}">${esc(options.downloadLabel || "Tải file dữ liệu")}</a>`
    : "";

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${esc(title)}</title><style>
  :root{--text:#2b2118;--muted:#74675b;--line:#d8cbbd;--soft:#fbf7f1;--brand:#7a4b2a;--green:#2f7d4a;--green-soft:#eff8f2;--green-border:rgba(47,125,74,.28);--page-width:${pageWidth}}
  *{box-sizing:border-box}html,body{max-width:100%;overflow-x:hidden}body{margin:0;background:#eee9e2;color:var(--text);font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.38}.page{width:min(var(--page-width),calc(100% - 20px));margin:10px auto;background:white;border:1px solid var(--line);box-shadow:0 12px 34px rgba(43,33,24,.13);padding:14px}.toolbar{position:sticky;top:0;z-index:2;display:flex;justify-content:flex-end;flex-wrap:wrap;gap:7px;background:rgba(255,255,255,.97);border-bottom:1px solid var(--line);padding:9px;margin:-14px -14px 14px;backdrop-filter:blur(10px)}.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid var(--green-border);border-radius:999px;background:var(--green-soft);color:#23653c;font-weight:800;padding:8px 12px;cursor:pointer;text-decoration:none;white-space:nowrap}.btn.secondary{border-color:var(--line);background:white;color:var(--text)}h1{font-size:20px;margin:0 0 4px;letter-spacing:-.02em;overflow-wrap:anywhere}h2{font-size:14px;margin:16px 0 7px}h3{font-size:12px;margin:0 0 5px}p{margin:3px 0;overflow-wrap:anywhere}.muted{color:var(--muted)}.head{display:flex;justify-content:space-between;gap:12px;border-bottom:2px solid var(--brand);padding-bottom:9px;margin-bottom:10px}.brand{font-weight:800;color:var(--brand);text-transform:uppercase;letter-spacing:.035em;overflow-wrap:anywhere}.grid,.summary-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px 10px}.box{border:1px solid var(--line);border-radius:8px;background:var(--soft);padding:9px;min-width:0}.kv{display:grid;grid-template-columns:minmax(82px,34%) minmax(0,1fr);gap:3px 7px}.kv b{color:var(--muted);font-weight:700}.kv span,.kv b{min-width:0;overflow-wrap:anywhere}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin:9px 0}.metric{border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--soft);min-width:0}.metric span{display:block;color:var(--muted);font-size:10px;overflow-wrap:anywhere}.metric b{font-size:15px;overflow-wrap:anywhere}table{width:100%;max-width:100%;border-collapse:collapse;margin-top:6px;table-layout:fixed}th,td{border:1px solid var(--line);padding:5px 6px;text-align:left;vertical-align:top;overflow-wrap:anywhere;word-break:break-word;hyphens:auto}th{background:#f4ede5;font-size:10px;color:#514438}.right{text-align:right}.center{text-align:center}.nowrap{white-space:nowrap}.item-sub{display:block;margin-top:2px;color:var(--muted);font-size:9px}.totals{width:min(310px,100%);margin:9px 0 0 auto}.totals .kv{grid-template-columns:1fr auto}.grand-total{font-size:14px;color:var(--brand)}.signatures{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:18px;text-align:center}.signature{min-height:54px}.signature b{display:block}.signature span{display:block;color:var(--muted);font-size:9px;margin-top:3px}.footer{margin-top:16px;color:var(--muted);font-size:9px;text-align:right}.compact{font-size:10px}.compact h1{font-size:17px}.compact h2{font-size:12px;margin:12px 0 5px}.compact th,.compact td{font-size:8.5px;padding:4px}.compact .metric{padding:6px}.compact .metric b{font-size:13px}@media(max-width:720px){.page{width:100%;margin:0;border:0;padding:12px}.toolbar{margin:-12px -12px 12px;justify-content:flex-start}.head,.grid,.summary-grid{display:grid;grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.kv{grid-template-columns:105px minmax(0,1fr)}.signatures{grid-template-columns:1fr}table{font-size:10px}}
  @media print{html,body{width:auto!important;max-width:none!important;overflow:visible!important;background:white!important}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{width:auto!important;max-width:none!important;margin:0!important;border:0!important;box-shadow:none!important;padding:0!important}.toolbar{display:none!important}a{color:inherit;text-decoration:none}table{table-layout:fixed!important}thead{display:table-header-group}tfoot{display:table-footer-group}tr,.box,.metric,.signature{break-inside:avoid-page;page-break-inside:avoid}h1,h2,h3{break-after:avoid-page;page-break-after:avoid}.head{break-inside:avoid-page}.footer{break-inside:avoid-page}@page{size:${pageSize} ${orientation};margin:${pageMargin}}}
  </style></head><body class="${compactClass.trim()}"><main class="page"><div class="toolbar"><a class="btn secondary" href="${esc(backHref)}">${esc(options.backLabel || "Quay lại phần mềm")}</a>${downloadAction}<button class="btn" onclick="window.print()">In hoặc lưu PDF</button></div>${body}<div class="footer">Báo cáo được lập lúc ${esc(reportDateTime(new Date().toISOString()))}</div></main></body></html>`;
}

export function htmlResponse(title: string, body: string, options: PrintHtmlOptions = {}) {
  return new Response(printHtml(title, body, options), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export function kv(items: Array<[string, Cell]>) {
  return `<div class="kv">${items.map(([key, value]) => `<b>${esc(key)}</b><span>${esc(value)}</span>`).join("")}</div>`;
}

export function table<T>(columns: Array<{ header: string; value: (row: T, index: number) => Cell; className?: string }>, rows: T[]) {
  const header = columns.map((column) => `<th class="${esc(column.className || "")}">${esc(column.header)}</th>`).join("");
  const body = rows.length
    ? rows.map((row, index) => `<tr>${columns.map((column) => `<td class="${esc(column.className || "")}">${esc(column.value(row, index))}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${columns.length}" class="center muted">Không có dữ liệu trong kỳ báo cáo</td></tr>`;
  return `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}
