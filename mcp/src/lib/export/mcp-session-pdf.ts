type Cell = string | number | boolean | null | undefined;

export type McpSessionPdfLine = {
  sortOrder?: number;
  accountName?: string;
  phone?: string;
  area?: string;
  status?: string;
  note?: string;
  hasOrder?: boolean;
  hasTest?: boolean;
  hasReport?: boolean;
  followupCount?: number;
};

export type McpSessionPdfInput = {
  routeName: Cell;
  sessionDate: Cell;
  owner: Cell;
  area: Cell;
  status: Cell;
  lines: McpSessionPdfLine[];
};

type PdfPage = { ops: string[] };

const PAGE_W = 595;
const PAGE_H = 842;
const M = 32;
const CONTENT_W = PAGE_W - M * 2;
const TEXT = "0.07 0.09 0.15";
const MUTED = "0.40 0.45 0.53";
const GREEN = "0.08 0.45 0.24";
const GREEN_SOFT = "0.94 0.99 0.96";
const GREEN_LINE = "0.73 0.90 0.78";
const LINE = "0.82 0.85 0.90";
const SOFT = "0.97 0.98 0.99";

function ascii(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ĐÐ]/g, "D")
    .replace(/đ/g, "d")
    .replace(/[^ -~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pdfEscape(value: unknown) {
  return ascii(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function truncate(value: unknown, max = 60) {
  const text = ascii(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

function fit(value: unknown, width: number, size: number) {
  return truncate(value, Math.max(4, Math.floor(width / (size * 0.52))));
}

function addText(page: PdfPage, value: unknown, x: number, y: number, size = 9, font = "F1", color = TEXT) {
  page.ops.push(`q ${color} rg BT /${font} ${size} Tf ${x} ${y} Td (${pdfEscape(value)}) Tj ET Q\n`);
}

function addRect(page: PdfPage, x: number, y: number, w: number, h: number, fill?: string, stroke?: string, strokeWidth = 0.7) {
  if (fill) page.ops.push(`q ${fill} rg ${x} ${y} ${w} ${h} re f Q\n`);
  if (stroke) page.ops.push(`q ${stroke} RG ${strokeWidth} w ${x} ${y} ${w} ${h} re S Q\n`);
}

function addLine(page: PdfPage, x1: number, y1: number, x2: number, y2: number, color = LINE, width = 0.5) {
  page.ops.push(`q ${color} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S Q\n`);
}

function statusLabel(status: unknown) {
  const value = ascii(status).toLowerCase();
  if (value === "pending") return "Cho ghe";
  if (value === "visited") return "Da ghe";
  if (value === "skipped") return "Bo qua";
  if (value === "cancelled") return "Huy";
  if (value === "opened" || value === "active") return "Dang mo";
  if (value === "done" || value === "completed") return "Da chot";
  return ascii(status) || "-";
}

function metric(page: PdfPage, x: number, y: number, w: number, label: string, value: Cell) {
  addRect(page, x, y, w, 40, GREEN_SOFT, GREEN_LINE, 0.7);
  addText(page, label, x + 9, y + 25, 6.8, "F2", MUTED);
  addText(page, value, x + 9, y + 8, 15, "F2", GREEN);
}

const columns = [
  { key: "stt", title: "#", w: 24 },
  { key: "name", title: "Khach", w: 134 },
  { key: "area", title: "Khu vuc", w: 62 },
  { key: "status", title: "TT", w: 48 },
  { key: "flags", title: "KQ", w: 58 },
  { key: "note", title: "Ghi chu", w: 205 }
];

function drawTableHeader(page: PdfPage, topY: number) {
  const headerH = 20;
  const y = topY - headerH;
  let x = M;
  addRect(page, M, y, CONTENT_W, headerH, GREEN_SOFT, GREEN_LINE, 0.7);
  columns.forEach((column) => {
    addText(page, column.title, x + 5, y + 7, 7.2, "F2", GREEN);
    if (x > M) addLine(page, x, y, x, y + headerH, GREEN_LINE, 0.45);
    x += column.w;
  });
  return y;
}

function drawRow(page: PdfPage, topY: number, row: McpSessionPdfLine, index: number) {
  const rowH = 17;
  const y = topY - rowH;
  const fill = index % 2 === 0 ? "1 1 1" : SOFT;
  const flags = [row.hasOrder ? "Don" : null, row.hasTest ? "Test" : null, row.hasReport ? "BC" : null].filter(Boolean).join("/") || "-";
  const values = [
    row.sortOrder || index + 1,
    [row.accountName, row.phone].filter(Boolean).join(" | "),
    row.area,
    statusLabel(row.status),
    `${flags}  FU:${row.followupCount || 0}`,
    row.note
  ];

  addRect(page, M, y, CONTENT_W, rowH, fill, LINE, 0.35);
  let x = M;
  columns.forEach((column, columnIndex) => {
    if (x > M) addLine(page, x, y, x, y + rowH, LINE, 0.25);
    addText(page, fit(values[columnIndex], column.w - 8, 7.1), x + 4, y + 5.2, 7.1, columnIndex === 1 ? "F2" : "F1", TEXT);
    x += column.w;
  });
  return y;
}

function finishPdf(pages: PdfPage[]) {
  const pageCount = Math.max(1, pages.length);
  pages.forEach((page, index) => {
    addLine(page, M, 38, M + CONTENT_W, 38, LINE, 0.5);
    addText(page, `MCP-Plan | Trang ${index + 1}/${pageCount}`, M, 24, 7.6, "F1", MUTED);
    addText(page, new Date().toLocaleString("vi-VN"), PAGE_W - 150, 24, 7.6, "F1", MUTED);
  });

  const objects: string[] = [];
  const pageObjectStart = 5;
  const contentObjectStart = pageObjectStart + pageCount;
  const kids = Array.from({ length: pageCount }, (_, index) => `${pageObjectStart + index} 0 R`).join(" ");

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

  pages.forEach((page, index) => {
    const pageObjectId = pageObjectStart + index;
    const contentObjectId = contentObjectStart + index;
    const stream = page.ops.join("");
    objects[pageObjectId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
    objects[contentObjectId] = `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}

export function buildMcpSessionPdf(input: McpSessionPdfInput) {
  const lines = input.lines || [];
  const planned = lines.length;
  const visited = lines.filter((r) => r.status === "visited").length;
  const skipped = lines.filter((r) => r.status === "skipped").length;
  const orders = lines.filter((r) => r.hasOrder).length;
  const tests = lines.filter((r) => r.hasTest).length;
  const reports = lines.filter((r) => r.hasReport).length;
  const followups = lines.reduce((sum, r) => sum + Number(r.followupCount || 0), 0);
  const visitRate = planned ? Math.round((visited / planned) * 100) : 0;
  const pages: PdfPage[] = [{ ops: [] }];
  const first = pages[0];

  addRect(first, M, 806, CONTENT_W, 4, GREEN);
  addText(first, "MCP-PLAN", M, 788, 10, "F2", GREEN);
  addText(first, "Bao cao phien MCP", M, 765, 21, "F2", TEXT);
  addRect(first, PAGE_W - 136, 766, 104, 24, GREEN_SOFT, GREEN_LINE, 0.7);
  addText(first, "XUAT PHIEN", PAGE_W - 116, 774, 8, "F2", GREEN);

  addRect(first, M, 690, CONTENT_W, 56, GREEN_SOFT, GREEN_LINE, 0.7);
  addText(first, `Tuyen: ${truncate(input.routeName, 70)}`, M + 12, 727, 9.2, "F2", TEXT);
  addText(first, `Ngay: ${ascii(input.sessionDate)}     Sale: ${truncate(input.owner, 32)}`, M + 12, 710, 8.5, "F1", TEXT);
  addText(first, `Khu vuc: ${truncate(input.area, 46)}     Trang thai: ${statusLabel(input.status)}`, M + 12, 696, 8.5, "F1", MUTED);

  const cardW = (CONTENT_W - 24) / 4;
  const gap = 8;
  const metricXs = [M, M + cardW + gap, M + (cardW + gap) * 2, M + (cardW + gap) * 3];
  metric(first, metricXs[0], 632, cardW, "Tong KH", planned);
  metric(first, metricXs[1], 632, cardW, "Da ghe", visited);
  metric(first, metricXs[2], 632, cardW, "Bo qua", skipped);
  metric(first, metricXs[3], 632, cardW, "Ty le ghe", `${visitRate}%`);
  metric(first, metricXs[0], 584, cardW, "Co don", orders);
  metric(first, metricXs[1], 584, cardW, "Co test", tests);
  metric(first, metricXs[2], 584, cardW, "Co BC", reports);
  metric(first, metricXs[3], 584, cardW, "Follow-up", followups);

  addText(first, `Checklist khach trong phien (${planned} KH)`, M, 552, 12, "F2", TEXT);
  let page = first;
  let cursor = drawTableHeader(page, 532);

  if (lines.length === 0) {
    addRect(page, M, cursor - 32, CONTENT_W, 32, SOFT, LINE, 0.4);
    addText(page, "Khong co du lieu checklist.", M + 12, cursor - 20, 8.5, "F1", MUTED);
  }

  lines.forEach((line, index) => {
    if (cursor - 17 < 54) {
      page = { ops: [] };
      pages.push(page);
      addRect(page, M, 806, CONTENT_W, 4, GREEN);
      addText(page, "MCP-PLAN", M, 788, 10, "F2", GREEN);
      addText(page, `Checklist tiep theo - ${truncate(input.routeName, 54)} - ${ascii(input.sessionDate)}`, M, 768, 12, "F2", TEXT);
      cursor = drawTableHeader(page, 744);
    }
    cursor = drawRow(page, cursor, line, index);
  });

  return finishPdf(pages);
}
