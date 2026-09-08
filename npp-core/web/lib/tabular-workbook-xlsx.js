export const TABULAR_WORKBOOK_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const TABULAR_WORKBOOK_XLSX_LIMITS = Object.freeze({
  maxSheets: 8,
  maxRowsPerSheet: 12001,
  maxColumns: 200,
  maxCells: 600000,
  maxOutputBytes: 24 * 1024 * 1024,
});

function xmlEscape(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStored(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    locals.push(local, data);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function columnName(index) {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function inlineCell(ref, value, style = 0) {
  return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function sanitizeSheetName(value) {
  const normalized = String(value ?? 'Dữ liệu').replace(/[\\/*?:\[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31);
  return normalized || 'Dữ liệu';
}

function uniqueSheetName(value, used) {
  const base = sanitizeSheetName(value);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate.toLocaleLowerCase('vi'))) {
    const marker = ` (${suffix})`;
    candidate = `${base.slice(0, Math.max(1, 31 - marker.length))}${marker}`;
    suffix += 1;
  }
  used.add(candidate.toLocaleLowerCase('vi'));
  return candidate;
}

function normalizeSheets(input, limits) {
  if (!Array.isArray(input) || input.length < 1 || input.length > limits.maxSheets) throw new Error('WORKBOOK_SHEET_LIMIT');
  const usedNames = new Set();
  let cellCount = 0;
  return input.map((sheet, index) => {
    if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) throw new Error('WORKBOOK_SHEET_INVALID');
    if (!Array.isArray(sheet.headers) || sheet.headers.length < 1 || sheet.headers.length > limits.maxColumns) throw new Error('WORKBOOK_COLUMN_LIMIT');
    if (!Array.isArray(sheet.rows) || sheet.rows.length + 1 > limits.maxRowsPerSheet) throw new Error('WORKBOOK_ROW_LIMIT');
    const headers = sheet.headers.map((value) => String(value ?? '').trim());
    if (headers.some((value) => !value)) throw new Error('WORKBOOK_HEADER_INVALID');
    if (new Set(headers.map((value) => value.toLocaleLowerCase('vi'))).size !== headers.length) throw new Error('WORKBOOK_HEADER_DUPLICATE');
    const rows = sheet.rows.map((row) => {
      if (!Array.isArray(row) || row.length > headers.length) throw new Error('WORKBOOK_COLUMN_LIMIT');
      return headers.map((_, columnIndex) => String(row[columnIndex] ?? ''));
    });
    cellCount += headers.length * Math.max(1, rows.length + 1);
    if (cellCount > limits.maxCells) throw new Error('WORKBOOK_CELL_LIMIT');
    return {
      sheetName: uniqueSheetName(sheet.sheetName ?? `Sheet ${index + 1}`, usedNames),
      headers,
      rows,
    };
  });
}

function worksheetXml(table) {
  const lastColumn = columnName(table.headers.length - 1);
  const lastRow = Math.max(2, table.rows.length + 1);
  const ref = `A1:${lastColumn}${lastRow}`;
  const headerCells = table.headers.map((value, index) => inlineCell(`${columnName(index)}1`, value, 1)).join('');
  const dataRows = table.rows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 2;
    const cells = row.map((value, columnIndex) => inlineCell(`${columnName(columnIndex)}${rowNumber}`, value)).join('');
    return `<row r="${rowNumber}">${cells}</row>`;
  }).join('');
  const emptyRow = table.rows.length === 0
    ? `<row r="2">${table.headers.map((_, index) => inlineCell(`${columnName(index)}2`, '')).join('')}</row>`
    : '';
  const widths = table.headers.map((header, index) => {
    const dataWidth = table.rows.reduce((max, row) => Math.max(max, String(row[index] ?? '').length), 0);
    const width = Math.min(52, Math.max(12, header.length + 2, dataWidth + 2));
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData><row r="1">${headerCells}</row>${dataRows}${emptyRow}</sheetData><autoFilter ref="${ref}"/></worksheet>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

export function createTabularWorkbookXlsx(input, limits = TABULAR_WORKBOOK_XLSX_LIMITS) {
  const sheets = normalizeSheets(input, limits);
  const sheetOverrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const workbookSheets = sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.sheetName)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('');
  const workbookRelationships = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('');
  const stylesRelationshipId = sheets.length + 1;
  const entries = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetOverrides}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRelationships}<Relationship Id="rId${stylesRelationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', STYLES_XML],
    ...sheets.map((sheet, index) => [`xl/worksheets/sheet${index + 1}.xml`, worksheetXml(sheet)]),
  ];
  const workbook = zipStored(entries);
  if (workbook.length > limits.maxOutputBytes) throw new Error('WORKBOOK_OUTPUT_LIMIT');
  return workbook;
}

export function workbookXlsxErrorMessage(error) {
  const code = error instanceof Error ? error.message : String(error ?? '');
  const messages = {
    WORKBOOK_SHEET_LIMIT: 'Tệp Excel có quá nhiều sheet.',
    WORKBOOK_SHEET_INVALID: 'Dữ liệu sheet Excel không hợp lệ.',
    WORKBOOK_COLUMN_LIMIT: 'Tệp Excel có quá nhiều cột.',
    WORKBOOK_ROW_LIMIT: 'Tệp Excel có quá nhiều dòng trong một sheet.',
    WORKBOOK_CELL_LIMIT: 'Tệp Excel có quá nhiều ô dữ liệu.',
    WORKBOOK_HEADER_INVALID: 'Tiêu đề cột Excel không hợp lệ.',
    WORKBOOK_HEADER_DUPLICATE: 'Tiêu đề cột Excel bị trùng.',
    WORKBOOK_OUTPUT_LIMIT: 'Tệp Excel vượt giới hạn dung lượng cho phép.',
  };
  return messages[code] ?? 'Không tạo được tệp Excel.';
}
