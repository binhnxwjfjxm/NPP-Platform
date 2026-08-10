import { inflateRawSync } from 'node:zlib';

export const PURCHASE_ORDER_XLSX_FILENAME = 'mau-nhap-don-dat-hang.xlsx';
export const PURCHASE_ORDER_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const PURCHASE_ORDER_XLSX_SHEET = 'Nhập đơn hàng';
export const PURCHASE_ORDER_XLSX_HEADERS = Object.freeze([
  'SKU', 'Số lượng', 'Đơn giá', 'Kiểu chiết khấu', 'Giá trị chiết khấu', 'Thuế %', 'Ghi chú',
]);

export const PURCHASE_ORDER_XLSX_LIMITS = Object.freeze({
  maxFileBytes: 2 * 1024 * 1024,
  maxEntries: 80,
  maxEntryBytes: 4 * 1024 * 1024,
  maxUncompressedBytes: 8 * 1024 * 1024,
  maxRows: 501,
  maxColumns: 7,
});

function xmlEscape(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function xmlUnescape(value) {
  return String(value ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
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

function inlineCell(ref, value, style = 0) {
  return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function numberCell(ref, value, style = 0) {
  return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${value}</v></c>`;
}

export function createPurchaseOrderXlsxTemplate() {
  const headerCells = PURCHASE_ORDER_XLSX_HEADERS.map((value, index) => inlineCell(`${String.fromCharCode(65 + index)}1`, value, 1)).join('');
  const sampleCells = [inlineCell('A2', 'SKU-MAU'), numberCell('B2', '10', 2), numberCell('C2', '25000', 3), inlineCell('D2', 'Giảm tổng dòng'), numberCell('E2', '0', 3), numberCell('F2', '8', 2), inlineCell('G2', '')].join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="20" customWidth="1"/><col min="2" max="2" width="12" customWidth="1"/><col min="3" max="3" width="16" customWidth="1"/><col min="4" max="4" width="22" customWidth="1"/><col min="5" max="5" width="18" customWidth="1"/><col min="6" max="6" width="12" customWidth="1"/><col min="7" max="7" width="34" customWidth="1"/></cols><sheetData><row r="1">${headerCells}</row><row r="2">${sampleCells}</row></sheetData><autoFilter ref="A1:G2"/><dataValidations count="1"><dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Giá trị không hợp lệ" error="Chọn một kiểu chiết khấu trong danh sách." sqref="D2:D501"><formula1>&quot;Giảm tổng dòng,% tiền hàng,Giảm mỗi đơn vị&quot;</formula1></dataValidation></dataValidations><tableParts count="1"><tablePart r:id="rId1"/></tableParts></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return zipStored([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(PURCHASE_ORDER_XLSX_SHEET)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', sheet],
    ['xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/></Relationships>`],
    ['xl/styles.xml', styles],
    ['xl/tables/table1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="NhapDonHang" displayName="NhapDonHang" ref="A1:G2" totalsRowShown="0"><autoFilter ref="A1:G2"/><tableColumns count="7">${PURCHASE_ORDER_XLSX_HEADERS.map((header, index) => `<tableColumn id="${index + 1}" name="${xmlEscape(header)}"/>`).join('')}</tableColumns><tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`],
  ]);
}

function locateEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  throw new Error('XLSX_ZIP_INVALID');
}

function readZipEntries(buffer, limits = PURCHASE_ORDER_XLSX_LIMITS) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length === 0 || buffer.length > limits.maxFileBytes) throw new Error('XLSX_FILE_SIZE_INVALID');
  const end = locateEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(end + 10);
  const centralSize = buffer.readUInt32LE(end + 12);
  const centralOffset = buffer.readUInt32LE(end + 16);
  if (entryCount === 0 || entryCount > limits.maxEntries) throw new Error('XLSX_ENTRY_COUNT_INVALID');
  if (centralOffset + centralSize > end) throw new Error('XLSX_ZIP_INVALID');
  const entries = new Map();
  let cursor = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('XLSX_ZIP_INVALID');
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    if ((flags & 0x1) !== 0 || ![0, 8].includes(method)) throw new Error('XLSX_ZIP_UNSUPPORTED');
    if (compressedSize > limits.maxFileBytes || uncompressedSize > limits.maxEntryBytes) throw new Error('XLSX_ENTRY_SIZE_INVALID');
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > limits.maxUncompressedBytes) throw new Error('XLSX_UNCOMPRESSED_SIZE_INVALID');
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buffer.length) throw new Error('XLSX_ZIP_INVALID');
    const name = buffer.subarray(nameStart, nameEnd).toString('utf8');
    if (!name || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..') || entries.has(name)) throw new Error('XLSX_ENTRY_NAME_INVALID');
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('XLSX_ZIP_INVALID');
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw new Error('XLSX_ZIP_INVALID');
    const compressed = buffer.subarray(dataStart, dataEnd);
    const data = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: limits.maxEntryBytes });
    if (data.length !== uncompressedSize) throw new Error('XLSX_ENTRY_SIZE_MISMATCH');
    entries.set(name, data);
    cursor = nameEnd + extraLength + commentLength;
  }
  return entries;
}

function attr(tag, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return match ? xmlUnescape(match[1]) : '';
}

function cellColumnIndex(ref) {
  const letters = String(ref ?? '').match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? '';
  if (!letters) return -1;
  let value = 0;
  for (const char of letters) value = value * 26 + char.charCodeAt(0) - 64;
  return value - 1;
}

function sharedStrings(entries) {
  const xml = entries.get('xl/sharedStrings.xml')?.toString('utf8');
  if (!xml) return [];
  const values = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) values.push([...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((item) => xmlUnescape(item[1])).join(''));
  return values;
}

function firstWorksheetPath(entries) {
  const workbook = entries.get('xl/workbook.xml')?.toString('utf8');
  const rels = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8');
  if (!workbook || !rels) throw new Error('XLSX_WORKBOOK_MISSING');
  const firstSheet = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"[^>]*\/?\s*>/);
  if (!firstSheet) throw new Error('XLSX_WORKSHEET_MISSING');
  for (const match of rels.matchAll(/<Relationship\b[^>]*\/?\s*>/g)) {
    if (attr(match[0], 'Id') !== firstSheet[1]) continue;
    const target = attr(match[0], 'Target').replace(/^\//, '');
    if (!target || target.includes('..') || target.includes('\\')) throw new Error('XLSX_WORKSHEET_INVALID');
    const path = target.startsWith('xl/') ? target : `xl/${target}`;
    if (!entries.has(path)) throw new Error('XLSX_WORKSHEET_MISSING');
    return path;
  }
  throw new Error('XLSX_WORKSHEET_MISSING');
}

function parseCellValue(cellTag, body, strings) {
  const type = attr(cellTag, 't');
  if (type === 'inlineStr') return [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => xmlUnescape(match[1])).join('');
  const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? '';
  if (type === 's') {
    const index = Number(raw);
    return Number.isInteger(index) && index >= 0 && index < strings.length ? strings[index] : '';
  }
  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
  return xmlUnescape(raw);
}

export function parsePurchaseOrderXlsx(buffer, limits = PURCHASE_ORDER_XLSX_LIMITS) {
  const entries = readZipEntries(Buffer.from(buffer), limits);
  const sheet = entries.get(firstWorksheetPath(entries))?.toString('utf8');
  if (!sheet) throw new Error('XLSX_WORKSHEET_MISSING');
  const strings = sharedStrings(entries);
  const rows = [];
  for (const rowMatch of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= limits.maxRows) throw new Error('XLSX_ROW_LIMIT_EXCEEDED');
    const cells = Array(limits.maxColumns).fill('');
    for (const cellMatch of rowMatch[1].matchAll(/(<c\b[^>]*>)([\s\S]*?)<\/c>/g)) {
      const column = cellColumnIndex(attr(cellMatch[1], 'r'));
      if (column < 0) continue;
      if (column >= limits.maxColumns) throw new Error('XLSX_COLUMN_LIMIT_EXCEEDED');
      cells[column] = parseCellValue(cellMatch[1], cellMatch[2], strings).replace(/[\r\n\t]+/g, ' ').trim();
    }
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
    if (cells.some((cell) => cell !== '')) rows.push(cells);
  }
  if (rows.length === 0) throw new Error('XLSX_EMPTY');
  return rows.map((row) => row.join('\t')).join('\r\n');
}

export function purchaseOrderXlsxErrorMessage(error) {
  const code = error instanceof Error ? error.message : String(error ?? '');
  if (code === 'XLSX_FILE_SIZE_INVALID') return 'Tệp XLSX không được vượt quá 2 MB.';
  if (code === 'XLSX_ROW_LIMIT_EXCEEDED') return 'Tệp XLSX vượt quá 500 dòng dữ liệu.';
  if (code === 'XLSX_COLUMN_LIMIT_EXCEEDED') return 'Tệp XLSX chỉ được có tối đa 7 cột dữ liệu.';
  if (['XLSX_ENTRY_COUNT_INVALID', 'XLSX_ENTRY_SIZE_INVALID', 'XLSX_UNCOMPRESSED_SIZE_INVALID'].includes(code)) return 'Tệp XLSX quá phức tạp hoặc có kích thước giải nén không an toàn.';
  return 'Tệp XLSX không hợp lệ hoặc không đọc được worksheet đầu tiên.';
}
