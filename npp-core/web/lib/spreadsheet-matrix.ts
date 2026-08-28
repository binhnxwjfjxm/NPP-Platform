function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell.replace(/\r$/, ''));
  if (row.length > 1 || row[0] !== '' || rows.length === 0) rows.push(row);
  return rows;
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function xmlTexts(fragment: string) {
  return Array.from(fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g), (match) => decodeXml(match[1])).join('');
}

function columnIndex(cellReference: string) {
  const letters = cellReference.match(/^[A-Za-z]+/)?.[0]?.toUpperCase();
  if (!letters) return -1;
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return result - 1;
}

function readUint16(view: DataView, offset: number) {
  return view.getUint16(offset, true);
}

function readUint32(view: DataView, offset: number) {
  return view.getUint32(offset, true);
}

type ZipEntry = { method: number; compressedSize: number; localOffset: number };

function zipDirectory(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (readUint32(view, offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error('Tệp Excel không đúng định dạng .xlsx');
  const entries = readUint16(view, eocd + 10);
  let offset = readUint32(view, eocd + 16);
  const decoder = new TextDecoder('utf-8');
  const directory = new Map<string, ZipEntry>();
  for (let index = 0; index < entries; index += 1) {
    if (readUint32(view, offset) !== 0x02014b50) throw new Error('Không đọc được danh mục trong tệp Excel');
    const method = readUint16(view, offset + 10);
    const compressedSize = readUint32(view, offset + 20);
    const fileNameLength = readUint16(view, offset + 28);
    const extraLength = readUint16(view, offset + 30);
    const commentLength = readUint16(view, offset + 32);
    const localOffset = readUint32(view, offset + 42);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + fileNameLength));
    directory.set(name, { method, compressedSize, localOffset });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return directory;
}

async function unzipText(buffer: ArrayBuffer, entry: ZipEntry) {
  const view = new DataView(buffer);
  if (readUint32(view, entry.localOffset) !== 0x04034b50) throw new Error('Không đọc được dữ liệu trong tệp Excel');
  const fileNameLength = readUint16(view, entry.localOffset + 26);
  const extraLength = readUint16(view, entry.localOffset + 28);
  const start = entry.localOffset + 30 + fileNameLength + extraLength;
  const compressed = new Uint8Array(buffer, start, entry.compressedSize);
  let output: Uint8Array;
  if (entry.method === 0) {
    output = compressed;
  } else if (entry.method === 8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Trình duyệt chưa hỗ trợ đọc tệp Excel nén');
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw' as never));
    output = new Uint8Array(await new Response(stream).arrayBuffer());
  } else {
    throw new Error('Tệp Excel dùng kiểu nén chưa được hỗ trợ');
  }
  return new TextDecoder('utf-8').decode(output);
}

function cellValue(attributes: string, body: string, sharedStrings: string[]) {
  const type = attributes.match(/\bt="([^"]+)"/)?.[1] ?? '';
  if (type === 'inlineStr') return xmlTexts(body);
  const raw = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1] ?? '';
  if (type === 's') return sharedStrings[Number(raw)] ?? '';
  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
  if (type === 'str') return decodeXml(raw);
  return decodeXml(raw);
}

async function parseXlsx(buffer: ArrayBuffer) {
  const directory = zipDirectory(buffer);
  const sheetNames = Array.from(directory.keys())
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((left, right) => {
      const leftNumber = Number(left.match(/sheet(\d+)/i)?.[1] ?? 0);
      const rightNumber = Number(right.match(/sheet(\d+)/i)?.[1] ?? 0);
      return leftNumber - rightNumber;
    });
  if (sheetNames.length === 0) throw new Error('Tệp Excel không có trang tính dữ liệu');

  const sharedEntry = directory.get('xl/sharedStrings.xml');
  const sharedStrings = sharedEntry
    ? Array.from((await unzipText(buffer, sharedEntry)).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g), (match) => xmlTexts(match[1]))
    : [];
  const sheetEntry = directory.get(sheetNames[0]);
  if (!sheetEntry) throw new Error('Không đọc được trang tính đầu tiên');
  const xml = await unzipText(buffer, sheetEntry);
  const rows: string[][] = [];

  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    const body = rowMatch[1];
    const matches = [
      ...Array.from(body.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g), (match) => ({ attributes: match[1], body: match[2] })),
      ...Array.from(body.matchAll(/<c\b([^>]*)\/>/g), (match) => ({ attributes: match[1], body: '' })),
    ];
    for (const cell of matches) {
      const reference = cell.attributes.match(/\br="([^"]+)"/)?.[1] ?? '';
      const index = columnIndex(reference);
      if (index < 0) continue;
      while (cells.length < index) cells.push('');
      cells[index] = cellValue(cell.attributes, cell.body, sharedStrings);
    }
    rows.push(cells);
  }
  return rows;
}

export async function readSpreadsheetMatrix(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  let rows: string[][];
  if (extension === 'csv') {
    rows = parseCsv(await file.text());
  } else if (extension === 'xlsx') {
    rows = await parseXlsx(await file.arrayBuffer());
  } else {
    throw new Error('Chỉ hỗ trợ tệp Excel .xlsx hoặc CSV .csv');
  }
  return rows.filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''));
}

export { parseCsv };
