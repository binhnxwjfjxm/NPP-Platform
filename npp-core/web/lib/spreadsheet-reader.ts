const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ENTRY_BYTES = 10 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 200;

function decodeXml(bytes: Uint8Array) {
  return new TextDecoder('utf-8').decode(bytes);
}

function parseXml(text: string) {
  const document = new DOMParser().parseFromString(text, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('Tệp Excel không đọc được.');
  return document;
}

function findEndOfCentralDirectory(view: DataView) {
  const minimum = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error('Tệp Excel không đúng định dạng .xlsx.');
}

type ZipEntry = Readonly<{
  name: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}>;

function listZipEntries(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const decoder = new TextDecoder('utf-8');
  const eocd = findEndOfCentralDirectory(view);
  const totalEntries = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (totalEntries > MAX_ZIP_ENTRIES) throw new Error('Tệp Excel có quá nhiều thành phần.');
  const entries = new Map<string, ZipEntry>();
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('Tệp Excel bị lỗi cấu trúc.');
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    if (uncompressedSize > MAX_ENTRY_BYTES) throw new Error('Tệp Excel có dữ liệu quá lớn.');
    const name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLength));
    entries.set(name.replace(/^\//, ''), { name, compression, compressedSize, uncompressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function unzipEntry(buffer: ArrayBuffer, entry: ZipEntry) {
  const view = new DataView(buffer);
  if (view.getUint32(entry.localOffset, true) !== 0x04034b50) throw new Error('Tệp Excel bị lỗi dữ liệu.');
  const nameLength = view.getUint16(entry.localOffset + 26, true);
  const extraLength = view.getUint16(entry.localOffset + 28, true);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const compressed = new Uint8Array(buffer.slice(start, start + entry.compressedSize));
  if (entry.compression === 0) return compressed;
  if (entry.compression !== 8) throw new Error('Tệp Excel dùng kiểu nén chưa được hỗ trợ.');
  if (typeof DecompressionStream === 'undefined') throw new Error('Trình duyệt chưa hỗ trợ đọc trực tiếp tệp Excel. Hãy lưu tệp thành CSV UTF-8.');
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const output = new Uint8Array(await new Response(stream).arrayBuffer());
  if (output.byteLength > MAX_ENTRY_BYTES) throw new Error('Tệp Excel có dữ liệu quá lớn.');
  return output;
}

function worksheetPath(workbook: Document, rels: Document) {
  const sheet = workbook.querySelector('sheet');
  const relationshipId = sheet?.getAttribute('r:id') || sheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  if (!relationshipId) return 'xl/worksheets/sheet1.xml';
  const relationship = Array.from(rels.querySelectorAll('Relationship')).find((item) => item.getAttribute('Id') === relationshipId);
  const target = relationship?.getAttribute('Target');
  if (!target) return 'xl/worksheets/sheet1.xml';
  const normalized = target.replace(/^\//, '').replace(/^\.\//, '');
  return normalized.startsWith('xl/') ? normalized : `xl/${normalized}`;
}

function sharedStrings(document: Document | null) {
  if (!document) return [];
  return Array.from(document.querySelectorAll('si')).map((item) => Array.from(item.querySelectorAll('t')).map((node) => node.textContent ?? '').join(''));
}

function columnIndex(reference: string) {
  const letters = /^([A-Z]+)/i.exec(reference)?.[1]?.toUpperCase() ?? 'A';
  let value = 0;
  for (const char of letters) value = value * 26 + char.charCodeAt(0) - 64;
  return Math.max(0, value - 1);
}

function worksheetRows(document: Document, strings: string[]) {
  const rows: string[][] = [];
  for (const row of Array.from(document.querySelectorAll('sheetData > row'))) {
    const values: string[] = [];
    for (const cell of Array.from(row.querySelectorAll('c'))) {
      const index = columnIndex(cell.getAttribute('r') ?? 'A1');
      const type = cell.getAttribute('t');
      const raw = cell.querySelector('v')?.textContent ?? '';
      let value = raw;
      if (type === 's') value = strings[Number.parseInt(raw, 10)] ?? '';
      if (type === 'inlineStr') value = Array.from(cell.querySelectorAll('is t')).map((node) => node.textContent ?? '').join('');
      values[index] = value.trim();
    }
    while (values.length && values[values.length - 1] === '') values.pop();
    if (values.some((value) => String(value ?? '').trim())) rows.push(values.map((value) => value ?? ''));
  }
  return rows;
}

function delimiterFor(line: string) {
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestCount = -1;
  for (const delimiter of candidates) {
    const count = splitDelimitedLine(line, delimiter).length - 1;
    if (count > bestCount) { best = delimiter; bestCount = count; }
  }
  return best;
}

function splitDelimitedLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      cells.push(value.trim());
      value = '';
    } else {
      value += character;
    }
  }
  cells.push(value.trim());
  return cells;
}

function csvRows(text: string) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const delimiter = delimiterFor(lines[0]);
  return lines.map((line) => splitDelimitedLine(line, delimiter));
}

export async function readSpreadsheetRows(file: File): Promise<string[][]> {
  if (file.size > MAX_FILE_BYTES) throw new Error('Tệp vượt quá 5 MB. Hãy chia dữ liệu thành tệp nhỏ hơn.');
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.csv')) return csvRows(await file.text());
  if (!lower.endsWith('.xlsx')) throw new Error('Chỉ nhận tệp Excel .xlsx hoặc CSV UTF-8.');

  const buffer = await file.arrayBuffer();
  const entries = listZipEntries(buffer);
  const workbookEntry = entries.get('xl/workbook.xml');
  const relsEntry = entries.get('xl/_rels/workbook.xml.rels');
  if (!workbookEntry || !relsEntry) throw new Error('Tệp Excel thiếu thông tin bảng tính.');
  const workbook = parseXml(decodeXml(await unzipEntry(buffer, workbookEntry)));
  const rels = parseXml(decodeXml(await unzipEntry(buffer, relsEntry)));
  const sheetEntry = entries.get(worksheetPath(workbook, rels));
  if (!sheetEntry) throw new Error('Không tìm thấy trang dữ liệu đầu tiên trong tệp Excel.');
  const sharedEntry = entries.get('xl/sharedStrings.xml');
  const strings = sharedEntry ? sharedStrings(parseXml(decodeXml(await unzipEntry(buffer, sharedEntry)))) : [];
  const sheet = parseXml(decodeXml(await unzipEntry(buffer, sheetEntry)));
  return worksheetRows(sheet, strings);
}
