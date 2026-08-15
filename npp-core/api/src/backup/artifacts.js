import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';

const SENSITIVE_TABLE_PATTERN = /(?:credential|session|challenge|idempotency|secret|token)/i;
const SENSITIVE_COLUMN_PATTERN = /(?:password(?:_hash)?|token(?:_hash)?|refresh_token|access_token|secret|api_key|private_key|database_url|connection_string|code_hash)/i;
const CANONICAL_SCHEMAS = Object.freeze(['shared', 'mcp', 'sales', 'purchasing', 'inventory', 'logistics', 'accounting', 'reporting']);
const FETCH_SIZE = 1000;

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text;
  if (value instanceof Date) text = value.toISOString();
  else if (Buffer.isBuffer(value)) text = `base64:${value.toString('base64')}`;
  else if (typeof value === 'object') text = JSON.stringify(value);
  else text = String(value);
  if (typeof value === 'string' && /^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xlsxCell(ref, value, header = false) {
  return `<c r="${ref}" t="inlineStr"${header ? ' s="1"' : ''}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
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

export function sanitizeSheetName(value, used = new Set()) {
  const base = String(value ?? 'Dữ liệu')
    .replace(/[\\/*?:\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31) || 'Dữ liệu';
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    const marker = ` ${suffix}`;
    candidate = `${base.slice(0, Math.max(1, 31 - marker.length))}${marker}`;
    suffix += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function crc32Update(crc, buffer) {
  let current = crc >>> 0;
  for (const byte of buffer) {
    current ^= byte;
    for (let bit = 0; bit < 8; bit += 1) current = (current >>> 1) ^ (0xedb88320 & -(current & 1));
  }
  return current >>> 0;
}

function crc32Finish(crc) {
  return (crc ^ 0xffffffff) >>> 0;
}

async function writeBuffer(stream, chunk) {
  if (stream.write(chunk)) return;
  await new Promise((resolve, reject) => {
    stream.once('drain', resolve);
    stream.once('error', reject);
  });
}

async function closeStream(stream) {
  await new Promise((resolve, reject) => {
    stream.once('error', reject);
    stream.end(resolve);
  });
}

export async function hashFile(filePath) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { sha256: hash.digest('hex'), size };
}

async function fileCrc32(filePath) {
  let crc = 0xffffffff;
  let size = 0;
  for await (const chunk of createReadStream(filePath)) {
    crc = crc32Update(crc, chunk);
    size += chunk.length;
  }
  return { crc32: crc32Finish(crc), size };
}

function localHeader(nameBytes, crc32, size) {
  const header = Buffer.alloc(30 + nameBytes.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt32LE(crc32 >>> 0, 14);
  header.writeUInt32LE(size, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  nameBytes.copy(header, 30);
  return header;
}

function centralHeader(nameBytes, crc32, size, offset) {
  const header = Buffer.alloc(46 + nameBytes.length);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt32LE(crc32 >>> 0, 16);
  header.writeUInt32LE(size, 20);
  header.writeUInt32LE(size, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt32LE(offset, 42);
  nameBytes.copy(header, 46);
  return header;
}

export async function writeStoredZip(outputPath, entries) {
  const output = createWriteStream(outputPath, { flags: 'wx' });
  const central = [];
  let offset = 0;
  try {
    for (let entry of entries) {
      const name = String(entry.name);
      const nameBytes = Buffer.from(name, 'utf8');
      let size;
      let crc32;
      if (entry.filePath) {
        const metadata = await fileCrc32(entry.filePath);
        size = metadata.size;
        crc32 = metadata.crc32;
      } else {
        const data = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(String(entry.content ?? ''), 'utf8');
        size = data.length;
        crc32 = crc32Finish(crc32Update(0xffffffff, data));
        entry = { ...entry, content: data };
      }
      if (size > 0xffffffff) throw new Error('BACKUP_ZIP_ENTRY_TOO_LARGE');
      const local = localHeader(nameBytes, crc32, size);
      await writeBuffer(output, local);
      if (entry.filePath) {
        for await (const chunk of createReadStream(entry.filePath)) await writeBuffer(output, chunk);
      } else {
        await writeBuffer(output, entry.content);
      }
      central.push(centralHeader(nameBytes, crc32, size, offset));
      offset += local.length + size;
    }
    const centralOffset = offset;
    for (const header of central) {
      await writeBuffer(output, header);
      offset += header.length;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(central.length, 8);
    end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(offset - centralOffset, 12);
    end.writeUInt32LE(centralOffset, 16);
    await writeBuffer(output, end);
    await closeStream(output);
  } catch (error) {
    output.destroy();
    throw error;
  }
  return hashFile(outputPath);
}

export async function discoverBackupDatasets(client) {
  const tables = await client.query(
    `SELECT table_schema, table_name, table_type
       FROM information_schema.tables
      WHERE table_schema = ANY($1::text[])
        AND table_type IN ('BASE TABLE', 'VIEW')
      ORDER BY table_schema, table_name`,
    [CANONICAL_SCHEMAS],
  );
  const datasets = [];
  for (const row of tables.rows) {
    const key = `${row.table_schema}.${row.table_name}`;
    if (SENSITIVE_TABLE_PATTERN.test(row.table_name)) continue;
    const columns = await client.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position`,
      [row.table_schema, row.table_name],
    );
    const safeColumns = columns.rows.map((item) => item.column_name).filter((name) => !SENSITIVE_COLUMN_PATTERN.test(name));
    if (!safeColumns.length) continue;
    datasets.push(Object.freeze({
      key,
      schema: row.table_schema,
      table: row.table_name,
      columns: Object.freeze(safeColumns),
    }));
  }
  return Object.freeze(datasets);
}

export async function exportDataset(client, dataset, { csvPath, xlsxSheetPath = null, sheetName = null }) {
  const csv = createWriteStream(csvPath, { flags: 'wx' });
  const csvHash = createHash('sha256');
  let csvSize = 0;
  const writeCsv = async (value) => {
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
    csvHash.update(buffer);
    csvSize += buffer.length;
    await writeBuffer(csv, buffer);
  };

  let sheet = null;
  if (xlsxSheetPath) sheet = createWriteStream(xlsxSheetPath, { flags: 'wx' });
  const writeSheet = async (value) => { if (sheet) await writeBuffer(sheet, Buffer.from(String(value), 'utf8')); };
  const cursor = `backup_cursor_${Math.random().toString(16).slice(2)}`;
  const selection = dataset.columns.map(quoteIdentifier).join(', ');
  const relation = `${quoteIdentifier(dataset.schema)}.${quoteIdentifier(dataset.table)}`;
  let rowCount = 0;
  try {
    await writeCsv(Buffer.from([0xef, 0xbb, 0xbf]));
    await writeCsv(`${dataset.columns.map(csvCell).join(',')}\r\n`);
    if (sheet) {
      const headerCells = dataset.columns.map((column, index) => xlsxCell(`${columnName(index)}1`, column, true)).join('');
      await writeSheet('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
      await writeSheet('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>');
      await writeSheet(`<row r="1">${headerCells}</row>`);
    }
    await client.query(`DECLARE ${quoteIdentifier(cursor)} NO SCROLL CURSOR FOR SELECT ${selection} FROM ${relation}`);
    while (true) {
      const result = await client.query(`FETCH FORWARD ${FETCH_SIZE} FROM ${quoteIdentifier(cursor)}`);
      if (!result.rows.length) break;
      for (const row of result.rows) {
        rowCount += 1;
        await writeCsv(`${dataset.columns.map((column) => csvCell(row[column])).join(',')}\r\n`);
        if (sheet) {
          const cells = dataset.columns.map((column, index) => {
            const raw = row[column];
            const value = raw === null || raw === undefined
              ? ''
              : Buffer.isBuffer(raw)
                ? `base64:${raw.toString('base64')}`
                : typeof raw === 'object'
                  ? JSON.stringify(raw)
                  : String(raw);
            return xlsxCell(`${columnName(index)}${rowCount + 1}`, value);
          }).join('');
          await writeSheet(`<row r="${rowCount + 1}">${cells}</row>`);
        }
      }
    }
    await client.query(`CLOSE ${quoteIdentifier(cursor)}`);
    if (sheet) await writeSheet('</sheetData></worksheet>');
    await closeStream(csv);
    if (sheet) await closeStream(sheet);
  } catch (error) {
    csv.destroy();
    sheet?.destroy();
    try { await client.query(`CLOSE ${quoteIdentifier(cursor)}`); } catch {}
    throw error;
  }
  return Object.freeze({
    key: dataset.key,
    rowCount,
    sha256: csvHash.digest('hex'),
    size: csvSize,
    csvPath,
    xlsxSheetPath,
    sheetName,
    exportedAt: new Date().toISOString(),
  });
}

function workbookStyles() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
}

export async function buildMultiSheetXlsx(outputPath, datasets) {
  const sheets = datasets.filter((dataset) => dataset.xlsxSheetPath);
  const contentTypes = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const workbookSheets = sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.sheetName)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('');
  const relationships = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('');
  const entries = [
    { name: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${contentTypes}</Types>` },
    { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', content: workbookStyles() },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, filePath: sheet.xlsxSheetPath })),
  ];
  return writeStoredZip(outputPath, entries);
}

export async function buildCsvBundle(outputPath, { jobId, snapshotAt, datasets }) {
  const internalManifest = {
    backupJobId: jobId,
    snapshotAt,
    datasets: datasets.map(({ key, rowCount, sha256 }) => ({ key, rowCount, sha256 })),
  };
  return writeStoredZip(outputPath, [
    { name: 'manifest.json', content: `${JSON.stringify(internalManifest, null, 2)}\n` },
    ...datasets.map((dataset) => ({
      name: `${dataset.key.replace(/[^A-Za-z0-9._-]/g, '_')}.csv`,
      filePath: dataset.csvPath,
    })),
  ]);
}

export async function fileMetadata(filePath) {
  const metadata = await stat(filePath);
  const hashed = await hashFile(filePath);
  return Object.freeze({ filePath, size: metadata.size, sha256: hashed.sha256 });
}

export async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}
