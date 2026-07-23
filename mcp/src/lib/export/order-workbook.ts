import { Buffer } from "node:buffer";

type CellValue = string | number | boolean | null | undefined;

type WorkbookItem = {
  sku: string;
  productName: string;
  brand: string;
  volume: string;
  weight: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  note: string;
  productId: string;
  variantId: string;
};

export type OrderWorkbookData = {
  company: {
    name: string;
    address: string;
    phone: string;
  };
  order: {
    id: string;
    code: string;
    date: string;
    source: string;
    sales: string;
    status: string;
    paymentMethod: string;
    routeSession: string;
    note: string;
    deliveryNote: string;
    customerId: string;
    customerName: string;
    customerPhone: string;
    area: string;
    deliveryAddress: string;
    subtotal: number;
    discountTotal: number;
    shippingFee: number;
    grandTotal: number;
    paidAmount: number;
  };
  location: {
    latitude: number | null;
    longitude: number | null;
    source: string;
    capturedAt: string;
    googleMapsUrl: string;
  };
  route: {
    id: string;
    name: string;
    sessionId: string;
    sessionDate: string;
  };
  items: WorkbookItem[];
};

type ZipEntry = {
  name: string;
  bytes: Buffer;
};

type SheetCell = {
  value?: CellValue;
  formula?: string;
  style?: number;
};

type SheetRow = {
  row: number;
  height?: number;
  cells: Array<{ col: number } & SheetCell>;
};

const DARK_BROWN = "6B3F2A";
const MID_BROWN = "8A5A44";
const BEIGE = "D8BFA8";
const LIGHT_BEIGE = "F3E7DA";
const TEXT_BROWN = "4A2F22";
const BORDER_BROWN = "B5967E";
const LINK_BLUE = "0563C1";

function xml(value: CellValue) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnName(index: number) {
  let value = index;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function cellRef(col: number, row: number) {
  return `${columnName(col)}${row}`;
}

function excelSerial(dateValue: string) {
  const raw = String(dateValue || "").slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return utc / 86_400_000 + 25_569;
}

function excelDateTimeSerial(dateValue: string) {
  if (!dateValue) return null;
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getTime() / 86_400_000 + 25_569;
}

function cellXml(row: number, cell: { col: number } & SheetCell) {
  const ref = cellRef(cell.col, row);
  const style = cell.style == null ? "" : ` s="${cell.style}"`;
  if (cell.formula) return `<c r="${ref}"${style}><f>${xml(cell.formula)}</f></c>`;
  if (typeof cell.value === "number" && Number.isFinite(cell.value)) {
    return `<c r="${ref}"${style}><v>${cell.value}</v></c>`;
  }
  if (typeof cell.value === "boolean") {
    return `<c r="${ref}"${style} t="b"><v>${cell.value ? 1 : 0}</v></c>`;
  }
  if (cell.value == null || cell.value === "") return `<c r="${ref}"${style}/>`;
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xml(cell.value)}</t></is></c>`;
}

function rowXml(row: SheetRow) {
  const height = row.height ? ` ht="${row.height}" customHeight="1"` : "";
  return `<row r="${row.row}"${height}>${row.cells.map((cell) => cellXml(row.row, cell)).join("")}</row>`;
}

function colsXml(widths: number[]) {
  return `<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols>`;
}

function mergeXml(ranges: string[]) {
  return ranges.length ? `<mergeCells count="${ranges.length}">${ranges.map((range) => `<mergeCell ref="${range}"/>`).join("")}</mergeCells>` : "";
}

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(value = new Date()) {
  const year = Math.max(value.getFullYear(), 1980);
  const date = ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate();
  const time = (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2);
  return { date, time };
}

function zip(entries: ZipEntry[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const timestamp = dosDateTime();

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = entry.bytes;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(timestamp.time, 10);
    local.writeUInt16LE(timestamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(timestamp.time, 12);
    central.writeUInt16LE(timestamp.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function stylesXml() {
  const thinBorder = `<border><left style="thin"><color rgb="FF${BORDER_BROWN}"/></left><right style="thin"><color rgb="FF${BORDER_BROWN}"/></right><top style="thin"><color rgb="FF${BORDER_BROWN}"/></top><bottom style="thin"><color rgb="FF${BORDER_BROWN}"/></bottom><diagonal/></border>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0 &quot;₫&quot;"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/><numFmt numFmtId="166" formatCode="dd/mm/yyyy hh:mm"/></numFmts>
  <fonts count="7">
    <font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font>
    <font><b/><color rgb="FF${TEXT_BROWN}"/><sz val="11"/><name val="Calibri"/></font>
    <font><b/><color rgb="FF${TEXT_BROWN}"/><sz val="16"/><name val="Calibri"/></font>
    <font><i/><color rgb="FF7A6A60"/><sz val="10"/><name val="Calibri"/></font>
    <font><u/><color rgb="FF${LINK_BLUE}"/><sz val="11"/><name val="Calibri"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="18"/><name val="Calibri"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF${DARK_BROWN}"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF${MID_BROWN}"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF${BEIGE}"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF${LIGHT_BEIGE}"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>${thinBorder}<border><left/><right/><top/><bottom style="medium"><color rgb="FF${DARK_BROWN}"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="18">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="6" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="2" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;
}

function sheet1Xml(data: OrderWorkbookData) {
  const rows: SheetRow[] = [];
  const merges = [
    "A1:B3", "C1:L1", "C2:L2", "C3:L3", "A4:L4",
    "A5:D5", "E5:H5", "I5:L5",
    ...Array.from({ length: 7 }, (_value, index) => {
      const row = index + 6;
      return [`A${row}:B${row}`, `C${row}:D${row}`, `E${row}:F${row}`, `G${row}:H${row}`, `I${row}:J${row}`, `K${row}:L${row}`];
    }).flat()
  ];

  rows.push(
    { row: 1, height: 28, cells: [{ col: 3, value: data.company.name, style: 1 }] },
    { row: 2, height: 20, cells: [{ col: 3, value: data.company.address, style: 2 }] },
    { row: 3, height: 20, cells: [{ col: 3, value: `Điện thoại: ${data.company.phone}`, style: 2 }] },
    { row: 4, height: 34, cells: [{ col: 1, value: "PHIẾU ĐƠN HÀNG", style: 3 }] },
    { row: 5, height: 23, cells: [{ col: 1, value: "THÔNG TIN ĐƠN HÀNG", style: 4 }, { col: 5, value: "THÔNG TIN KHÁCH HÀNG", style: 4 }, { col: 9, value: "GIAO NHẬN & ĐỊNH VỊ", style: 4 }] }
  );

  const dateSerial = excelSerial(data.order.date);
  const capturedSerial = excelDateTimeSerial(data.location.capturedAt);
  const orderFields: Array<[string, CellValue, number?]> = [
    ["Mã đơn", data.order.code],
    ["Ngày lập", dateSerial ?? data.order.date, dateSerial != null ? 11 : 6],
    ["Nguồn đơn", data.order.source],
    ["Sale", data.order.sales],
    ["Trạng thái", data.order.status],
    ["Thanh toán", data.order.paymentMethod],
    ["Tuyến / phiên MCP", data.order.routeSession]
  ];
  const customerFields: Array<[string, CellValue]> = [
    ["Mã khách", data.order.customerId],
    ["Khách hàng", data.order.customerName],
    ["SĐT", data.order.customerPhone],
    ["Khu vực", data.order.area],
    ["Địa chỉ giao", data.order.deliveryAddress],
    ["", ""],
    ["", ""]
  ];
  const deliveryFields: Array<[string, CellValue, number?]> = [
    ["Ghi chú giao", data.order.deliveryNote],
    ["Latitude", data.location.latitude],
    ["Longitude", data.location.longitude],
    ["Nguồn GPS", data.location.source],
    ["Ghi nhận lúc", capturedSerial ?? data.location.capturedAt, capturedSerial != null ? 12 : 6],
    ["Google Maps", data.location.googleMapsUrl ? "Mở vị trí trên Google Maps ↗" : "Chưa có vị trí", data.location.googleMapsUrl ? 13 : 6],
    ["", ""]
  ];

  for (let index = 0; index < 7; index += 1) {
    const row = index + 6;
    const [orderLabel, orderValue, orderStyle = 6] = orderFields[index];
    const [customerLabel, customerValue] = customerFields[index];
    const [deliveryLabel, deliveryValue, deliveryStyle = 6] = deliveryFields[index];
    rows.push({ row, height: index === 4 || index === 5 ? 28 : 24, cells: [
      { col: 1, value: orderLabel, style: orderLabel ? 5 : 6 }, { col: 3, value: orderValue, style: orderStyle },
      { col: 5, value: customerLabel, style: customerLabel ? 5 : 6 }, { col: 7, value: customerValue, style: 6 },
      { col: 9, value: deliveryLabel, style: deliveryLabel ? 5 : 6 }, { col: 11, value: deliveryValue, style: deliveryStyle }
    ] });
  }

  const headerRow = 13;
  const itemStart = 14;
  rows.push({ row: headerRow, height: 31, cells: [
    "STT", "MÃ HÀNG", "TÊN SẢN PHẨM", "THƯƠNG HIỆU", "DUNG TÍCH", "KHỐI LƯỢNG", "ĐVT", "SL", "ĐƠN GIÁ", "CHIẾT KHẤU", "THÀNH TIỀN", "GHI CHÚ"
  ].map((value, index) => ({ col: index + 1, value, style: 7 })) });

  const itemRows = data.items.length ? data.items : [{ sku: "", productName: "Chưa có sản phẩm", brand: "", volume: "", weight: "", unit: "", quantity: 0, unitPrice: 0, discount: 0, lineTotal: 0, note: "", productId: "", variantId: "" }];
  itemRows.forEach((item, index) => {
    const row = itemStart + index;
    rows.push({ row, height: 23, cells: [
      { col: 1, value: index + 1, style: 8 },
      { col: 2, value: item.sku, style: 8 },
      { col: 3, value: item.productName, style: 6 },
      { col: 4, value: item.brand, style: 6 },
      { col: 5, value: item.volume, style: 8 },
      { col: 6, value: item.weight, style: 8 },
      { col: 7, value: item.unit, style: 8 },
      { col: 8, value: item.quantity, style: 9 },
      { col: 9, value: item.unitPrice, style: 10 },
      { col: 10, value: item.discount, style: 10 },
      { col: 11, formula: `MAX(H${row}*I${row}-J${row},0)`, style: 10 },
      { col: 12, value: item.note, style: 6 }
    ] });
  });

  const itemEnd = itemStart + itemRows.length - 1;
  const totalsStart = itemEnd + 2;
  merges.push(`A${totalsStart}:H${totalsStart}`, `I${totalsStart}:J${totalsStart}`, `K${totalsStart}:L${totalsStart}`);
  rows.push({ row: totalsStart, height: 28, cells: [
    { col: 1, value: data.order.note ? `Ghi chú đơn: ${data.order.note}` : "", style: 6 },
    { col: 9, value: "Tạm tính", style: 14 },
    { col: 11, formula: `SUMPRODUCT(H${itemStart}:H${itemEnd},I${itemStart}:I${itemEnd})`, style: 15 }
  ] });

  const totalRows: Array<[string, number | null, string | null]> = [
    ["Chiết khấu đơn", null, `SUM(J${itemStart}:J${itemEnd})`],
    ["Phí giao hàng", data.order.shippingFee, null],
    ["Tổng thanh toán", null, `SUM(K${itemStart}:K${itemEnd})+K${totalsStart + 2}`],
    ["Đã thanh toán", data.order.paidAmount, null],
    ["Còn phải thu", null, `MAX(K${totalsStart + 3}-K${totalsStart + 4},0)`]
  ];
  totalRows.forEach(([label, value, formula], index) => {
    const row = totalsStart + index + 1;
    merges.push(`I${row}:J${row}`, `K${row}:L${row}`);
    rows.push({ row, height: 25, cells: [
      { col: 9, value: label, style: 14 },
      formula ? { col: 11, formula, style: 15 } : { col: 11, value: value ?? 0, style: 15 }
    ] });
  });

  const signatureTop = totalsStart + totalRows.length + 3;
  merges.push(`A${signatureTop}:C${signatureTop}`, `E${signatureTop}:G${signatureTop}`, `I${signatureTop}:L${signatureTop}`);
  merges.push(`A${signatureTop + 1}:C${signatureTop + 1}`, `E${signatureTop + 1}:G${signatureTop + 1}`, `I${signatureTop + 1}:L${signatureTop + 1}`);
  rows.push(
    { row: signatureTop, height: 23, cells: [{ col: 1, value: "KHÁCH HÀNG", style: 17 }, { col: 5, value: "NHÂN VIÊN SALE", style: 17 }, { col: 9, value: "KHO / GIAO HÀNG", style: 17 }] },
    { row: signatureTop + 1, height: 66, cells: [{ col: 1, value: "(Ký, ghi rõ họ tên)", style: 16 }, { col: 5, value: "(Ký, ghi rõ họ tên)", style: 16 }, { col: 9, value: "(Ký, ghi rõ họ tên)", style: 16 }] }
  );

  const hyperlinks = data.location.googleMapsUrl ? `<hyperlinks><hyperlink ref="K11:L11" r:id="rId2" display="Mở vị trí trên Google Maps ↗"/></hyperlinks>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:L${signatureTop + 1}"/>
  <sheetViews><sheetView workbookViewId="0" showGridLines="0" zoomScale="90"><selection activeCell="A1" sqref="A1"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  ${colsXml([5, 14, 31, 16, 13, 14, 11, 9, 15, 14, 17, 22])}
  <sheetData>${rows.map(rowXml).join("")}</sheetData>
  ${mergeXml(merges)}
  ${hyperlinks}
  <printOptions horizontalCentered="1"/>
  <pageMargins left="0.25" right="0.25" top="0.3" bottom="0.3" header="0.1" footer="0.1"/>
  <pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>
  <headerFooter><oddFooter>&amp;L${xml(data.company.name)}&amp;RTrang &amp;P / &amp;N</oddFooter></headerFooter>
  <drawing r:id="rId1"/>
</worksheet>`;
}

function sheet2Xml(data: OrderWorkbookData) {
  const headers = [
    "Mã đơn", "Ngày lập", "Nguồn đơn", "Trạng thái", "Sale", "Hình thức thanh toán", "Mã khách", "Tên khách hàng", "Số điện thoại", "Khu vực", "Địa chỉ giao hàng", "Mã tuyến", "Tên tuyến", "Mã phiên MCP", "Ngày phiên MCP", "Latitude", "Longitude", "Nguồn GPS", "GPS ghi nhận lúc", "Google Maps", "Mã hàng", "Tên sản phẩm", "Thương hiệu", "Dung tích", "Khối lượng", "Đơn vị tính", "Số lượng", "Đơn giá", "Chiết khấu dòng", "Thành tiền", "Tạm tính đơn", "Chiết khấu đơn", "Phí giao hàng", "Tổng thanh toán", "Đã thanh toán", "Còn phải thu", "Ghi chú sản phẩm", "Ghi chú đơn", "Ghi chú giao", "Mã sản phẩm", "Mã quy cách", "Mã đơn hệ thống"
  ];
  const rows: SheetRow[] = [{ row: 1, height: 30, cells: headers.map((value, index) => ({ col: index + 1, value, style: 7 })) }];
  const orderDate = excelSerial(data.order.date);
  const sessionDate = excelSerial(data.route.sessionDate);
  const capturedAt = excelDateTimeSerial(data.location.capturedAt);
  const due = Math.max(data.order.grandTotal + data.order.shippingFee - data.order.paidAmount, 0);
  const hyperlinkRefs: string[] = [];

  const items = data.items.length ? data.items : [{ sku: "", productName: "", brand: "", volume: "", weight: "", unit: "", quantity: 0, unitPrice: 0, discount: 0, lineTotal: 0, note: "", productId: "", variantId: "" }];
  items.forEach((item, index) => {
    const row = index + 2;
    const values: Array<SheetCell> = [
      { value: data.order.code }, { value: orderDate ?? data.order.date, style: orderDate != null ? 11 : 6 }, { value: data.order.source }, { value: data.order.status }, { value: data.order.sales }, { value: data.order.paymentMethod },
      { value: data.order.customerId }, { value: data.order.customerName }, { value: data.order.customerPhone }, { value: data.order.area }, { value: data.order.deliveryAddress },
      { value: data.route.id }, { value: data.route.name }, { value: data.route.sessionId }, { value: sessionDate ?? data.route.sessionDate, style: sessionDate != null ? 11 : 6 },
      { value: data.location.latitude }, { value: data.location.longitude }, { value: data.location.source }, { value: capturedAt ?? data.location.capturedAt, style: capturedAt != null ? 12 : 6 },
      { value: data.location.googleMapsUrl ? "Mở vị trí trên Google Maps ↗" : "", style: data.location.googleMapsUrl ? 13 : 6 },
      { value: item.sku }, { value: item.productName }, { value: item.brand }, { value: item.volume }, { value: item.weight }, { value: item.unit },
      { value: item.quantity, style: 9 }, { value: item.unitPrice, style: 10 }, { value: item.discount, style: 10 }, { value: item.lineTotal, style: 10 },
      { value: data.order.subtotal, style: 10 }, { value: data.order.discountTotal, style: 10 }, { value: data.order.shippingFee, style: 10 }, { value: data.order.grandTotal + data.order.shippingFee, style: 10 }, { value: data.order.paidAmount, style: 10 }, { value: due, style: 10 },
      { value: item.note }, { value: data.order.note }, { value: data.order.deliveryNote }, { value: item.productId }, { value: item.variantId }, { value: data.order.id }
    ];
    rows.push({ row, height: 22, cells: values.map((cell, cellIndex) => ({ col: cellIndex + 1, style: cell.style ?? 6, value: cell.value })) });
    if (data.location.googleMapsUrl) hyperlinkRefs.push(`T${row}`);
  });

  const hyperlinks = hyperlinkRefs.length ? `<hyperlinks>${hyperlinkRefs.map((ref, index) => `<hyperlink ref="${ref}" r:id="rId${index + 1}" display="Mở vị trí trên Google Maps ↗"/>`).join("")}</hyperlinks>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:AP${rows.length}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  ${colsXml([16, 12, 24, 15, 18, 22, 18, 28, 16, 18, 32, 18, 24, 22, 16, 13, 13, 16, 20, 28, 16, 32, 18, 14, 14, 14, 12, 15, 17, 17, 17, 18, 16, 18, 17, 17, 24, 24, 24, 20, 20, 24])}
  <sheetData>${rows.map(rowXml).join("")}</sheetData>
  <autoFilter ref="A1:AP${rows.length}"/>
  ${hyperlinks}
  <pageMargins left="0.25" right="0.25" top="0.3" bottom="0.3" header="0.1" footer="0.1"/>
  <pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

function workbookXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews>
  <sheets><sheet name="Phiếu đơn hàng" sheetId="1" r:id="rId1"/><sheet name="Dữ liệu đơn" sheetId="2" r:id="rId2"/></sheets>
  <calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/>
</workbook>`;
}

function contentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
}

function rootRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function workbookRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function sheet1RelationshipsXml(data: OrderWorkbookData) {
  const map = data.location.googleMapsUrl ? `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(data.location.googleMapsUrl)}" TargetMode="External"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
  ${map}
</Relationships>`;
}

function sheet2RelationshipsXml(data: OrderWorkbookData) {
  if (!data.location.googleMapsUrl) return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;
  const hyperlinkCount = Math.max(data.items.length, 1);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${Array.from({ length: hyperlinkCount }, (_item, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(data.location.googleMapsUrl)}" TargetMode="External"/>`).join("")}
</Relationships>`;
}

function drawingXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:twoCellAnchor editAs="oneCell">
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Logo Hưng Phát" descr="Logo công ty Hưng Phát"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm/><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
</xdr:wsDr>`;
}

function drawingRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`;
}

function coreXml() {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Công ty TNHH TM Nguyên Liệu Hưng Phát</dc:creator><cp:lastModifiedBy>MCP Plan</cp:lastModifiedBy><dc:title>Phiếu đơn hàng Hưng Phát</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
}

function appXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>MCP Plan</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>2</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="2" baseType="lpstr"><vt:lpstr>Phiếu đơn hàng</vt:lpstr><vt:lpstr>Dữ liệu đơn</vt:lpstr></vt:vector></TitlesOfParts><Company>Công ty TNHH TM Nguyên Liệu Hưng Phát</Company><AppVersion>1.0</AppVersion></Properties>`;
}

function asEntry(name: string, content: string | Buffer): ZipEntry {
  return { name, bytes: Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8") };
}

export function buildOrderWorkbook(data: OrderWorkbookData, logoPng: Buffer) {
  const entries: ZipEntry[] = [
    asEntry("[Content_Types].xml", contentTypesXml()),
    asEntry("_rels/.rels", rootRelationshipsXml()),
    asEntry("docProps/core.xml", coreXml()),
    asEntry("docProps/app.xml", appXml()),
    asEntry("xl/workbook.xml", workbookXml()),
    asEntry("xl/_rels/workbook.xml.rels", workbookRelationshipsXml()),
    asEntry("xl/styles.xml", stylesXml()),
    asEntry("xl/worksheets/sheet1.xml", sheet1Xml(data)),
    asEntry("xl/worksheets/_rels/sheet1.xml.rels", sheet1RelationshipsXml(data)),
    asEntry("xl/worksheets/sheet2.xml", sheet2Xml(data)),
    asEntry("xl/worksheets/_rels/sheet2.xml.rels", sheet2RelationshipsXml(data)),
    asEntry("xl/drawings/drawing1.xml", drawingXml()),
    asEntry("xl/drawings/_rels/drawing1.xml.rels", drawingRelationshipsXml()),
    asEntry("xl/media/image1.png", logoPng)
  ];
  return zip(entries);
}
