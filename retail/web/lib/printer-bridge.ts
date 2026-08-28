'use client';

export type PrinterPaper = 'A4' | 'A5' | '80mm' | '58mm';
export type PrinterMethod = 'SYSTEM' | 'DIRECT_WIFI';
export type PrinterProtocol = 'ESC_POS' | 'IPP' | 'SYSTEM';

export type PrinterProfile = {
  id: string;
  name: string;
  connectionType: 'LAN' | 'SYSTEM';
  protocol: PrinterProtocol;
  host?: string | null;
  port?: number | null;
  serviceName?: string | null;
  serviceType?: string | null;
  serviceDomain?: string | null;
  paper: PrinterPaper;
  lastVerifiedAt?: string | null;
  lastVerifiedStatus?: 'READY' | 'OFFLINE' | 'UNKNOWN';
};

export type PrinterSettings = {
  version: 1;
  method: PrinterMethod;
  paper: PrinterPaper;
  copies: number;
  previewBeforePrint: boolean;
  profile: PrinterProfile | null;
};

export type PrinterBridgeCapabilities = {
  version: string;
  directWifi: boolean;
  discovery: boolean;
  manualIp: boolean;
  protocols: PrinterProtocol[];
  cashDrawer: boolean;
};

export type RetailPrintPayload = {
  documentType: 'SALES_ORDER' | 'PRINTER_TEST';
  paper: PrinterPaper;
  copies: number;
  heading?: string | null;
  title: string;
  subtitle?: string | null;
  documentNumber?: string | null;
  meta: Array<{ label: string; value: string }>;
  columns: string[];
  rows: string[][];
  totals: Array<{ label: string; value: string }>;
  footer?: string[];
};

type BridgeRequest = {
  action: 'capabilities' | 'discover' | 'test' | 'print' | 'forget';
  payload?: unknown;
};

type BridgeResponse<T> = {
  ok: boolean;
  data?: T;
  code?: string;
  message?: string;
  safeToFallback?: boolean;
};

type NativeBridge = {
  version?: string;
  request(request: BridgeRequest): Promise<BridgeResponse<unknown>>;
};

declare global {
  interface Window {
    RetailPrinterBridge?: NativeBridge;
  }
}

export class RetailPrinterError extends Error {
  readonly code: string;
  readonly safeToFallback: boolean;

  constructor(code: string, message: string, safeToFallback = false) {
    super(message);
    this.name = 'RetailPrinterError';
    this.code = code;
    this.safeToFallback = safeToFallback;
  }
}

export const PRINTER_SETTINGS_STORAGE_KEY = 'retail.printer.settings.v1';

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  version: 1,
  method: 'SYSTEM',
  paper: 'A4',
  copies: 1,
  previewBeforePrint: true,
  profile: null,
};

const PAPERS = new Set<PrinterPaper>(['A4', 'A5', '80mm', '58mm']);
const PROTOCOLS = new Set<PrinterProtocol>(['ESC_POS', 'IPP', 'SYSTEM']);

function safePaper(value: unknown): PrinterPaper {
  return PAPERS.has(value as PrinterPaper) ? value as PrinterPaper : DEFAULT_PRINTER_SETTINGS.paper;
}

function safeCopies(value: unknown) {
  const count = Number(value);
  return Number.isInteger(count) ? Math.max(1, Math.min(5, count)) : 1;
}

function safePort(value: unknown) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 9100;
}

function safeText(value: unknown, maxLength = 200) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalizeProfile(value: unknown, paper: PrinterPaper): PrinterProfile | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<PrinterProfile>;
  const name = safeText(source.name, 120);
  const id = safeText(source.id, 180);
  if (!name || !id) return null;
  const protocol = PROTOCOLS.has(source.protocol as PrinterProtocol) ? source.protocol as PrinterProtocol : 'ESC_POS';
  return {
    id,
    name,
    connectionType: source.connectionType === 'SYSTEM' ? 'SYSTEM' : 'LAN',
    protocol,
    host: source.host ? safeText(source.host, 255) : null,
    port: source.port == null ? null : safePort(source.port),
    serviceName: source.serviceName ? safeText(source.serviceName, 180) : null,
    serviceType: source.serviceType ? safeText(source.serviceType, 80) : null,
    serviceDomain: source.serviceDomain ? safeText(source.serviceDomain, 120) : null,
    paper: safePaper(source.paper ?? paper),
    lastVerifiedAt: source.lastVerifiedAt ? safeText(source.lastVerifiedAt, 80) : null,
    lastVerifiedStatus: source.lastVerifiedStatus === 'READY' || source.lastVerifiedStatus === 'OFFLINE' ? source.lastVerifiedStatus : 'UNKNOWN',
  };
}

export function loadPrinterSettings(): PrinterSettings {
  if (typeof window === 'undefined') return DEFAULT_PRINTER_SETTINGS;
  try {
    const raw = window.localStorage.getItem(PRINTER_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_PRINTER_SETTINGS;
    const source = JSON.parse(raw) as Partial<PrinterSettings>;
    const paper = safePaper(source.paper);
    return {
      version: 1,
      method: source.method === 'DIRECT_WIFI' ? 'DIRECT_WIFI' : 'SYSTEM',
      paper,
      copies: safeCopies(source.copies),
      previewBeforePrint: source.previewBeforePrint !== false,
      profile: normalizeProfile(source.profile, paper),
    };
  } catch {
    return DEFAULT_PRINTER_SETTINGS;
  }
}

export function savePrinterSettings(settings: PrinterSettings) {
  const paper = safePaper(settings.paper);
  const normalized: PrinterSettings = {
    version: 1,
    method: settings.method === 'DIRECT_WIFI' ? 'DIRECT_WIFI' : 'SYSTEM',
    paper,
    copies: safeCopies(settings.copies),
    previewBeforePrint: settings.previewBeforePrint !== false,
    profile: normalizeProfile(settings.profile, paper),
  };
  window.localStorage.setItem(PRINTER_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  window.localStorage.setItem('retail.print.paper', normalized.paper);
  return normalized;
}

function bridge(): NativeBridge | null {
  if (typeof window === 'undefined') return null;
  const candidate = window.RetailPrinterBridge;
  return candidate && typeof candidate.request === 'function' ? candidate : null;
}

async function request<T>(action: BridgeRequest['action'], payload?: unknown): Promise<T> {
  const current = bridge();
  if (!current) {
    throw new RetailPrinterError('BRIDGE_UNAVAILABLE', 'Thiết bị này chưa hỗ trợ in Wi‑Fi trực tiếp.', true);
  }
  let response: BridgeResponse<unknown>;
  try {
    response = await current.request({ action, payload });
  } catch {
    throw new RetailPrinterError('BRIDGE_REQUEST_FAILED', 'Không thể liên lạc với bộ phận in trên thiết bị.', true);
  }
  if (!response?.ok) {
    throw new RetailPrinterError(
      response?.code || 'PRINTER_REQUEST_FAILED',
      response?.message || 'Không thể thực hiện thao tác với máy in.',
      response?.safeToFallback === true,
    );
  }
  return response.data as T;
}

export async function getPrinterCapabilities(): Promise<PrinterBridgeCapabilities> {
  if (!bridge()) {
    return { version: 'web', directWifi: false, discovery: false, manualIp: false, protocols: ['SYSTEM'], cashDrawer: false };
  }
  return request<PrinterBridgeCapabilities>('capabilities');
}

export async function discoverPrinters(): Promise<PrinterProfile[]> {
  const rows = await request<PrinterProfile[]>('discover');
  return Array.isArray(rows) ? rows.map((row) => normalizeProfile(row, row.paper ?? '80mm')).filter((row): row is PrinterProfile => Boolean(row)) : [];
}

export async function testDirectPrinter(profile: PrinterProfile, payload: RetailPrintPayload) {
  return request<{ verifiedAt?: string }>('test', { profile, payload });
}

export async function printWithConfiguredPrinter(settings: PrinterSettings, payload: RetailPrintPayload) {
  if (settings.method !== 'DIRECT_WIFI') {
    throw new RetailPrinterError('DIRECT_PRINT_NOT_SELECTED', 'Phương thức in hiện tại là In bằng hệ thống.', true);
  }
  if (!settings.profile) {
    throw new RetailPrinterError('PRINTER_NOT_SELECTED', 'Chưa chọn máy in Wi‑Fi/LAN.', true);
  }
  return request<{ printedCopies?: number }>('print', {
    profile: { ...settings.profile, paper: settings.paper },
    payload: { ...payload, paper: settings.paper, copies: settings.copies },
  });
}

export async function forgetNativePrinter(profile: PrinterProfile | null) {
  if (!profile || !bridge()) return;
  await request('forget', { profile });
}

export function printerSettingsSummary(settings: PrinterSettings) {
  if (settings.method === 'DIRECT_WIFI') {
    return settings.profile ? `${settings.profile.name} · ${settings.paper}` : `Wi‑Fi trực tiếp · ${settings.paper}`;
  }
  return `In bằng hệ thống · ${settings.paper}`;
}

export function buildSalesOrderPrintPayload(input: {
  paper: PrinterPaper;
  copies: number;
  heading?: string | null;
  title: string;
  subtitle?: string | null;
  documentNumber?: string | null;
  customer?: string | null;
  warehouse?: string | null;
  date?: string | null;
  visibleFields: Set<string>;
  lines: Array<{ itemName: string; sku: string; quantity: string; unitCode: string; unitPrice: string; lineTotal: string }>;
  total: string;
}): RetailPrintPayload {
  const columns = [
    ...(input.visibleFields.has('line_no') ? ['STT'] : []),
    'Sản phẩm',
    ...(input.visibleFields.has('line_quantity') ? ['SL'] : []),
    'ĐVT',
    ...(input.visibleFields.has('line_unit_price') ? ['Đơn giá'] : []),
    ...(input.visibleFields.has('line_total') ? ['Thành tiền'] : []),
  ];
  const rows = input.visibleFields.has('line_item') ? input.lines.map((line, index) => [
    ...(input.visibleFields.has('line_no') ? [String(index + 1)] : []),
    `${line.itemName}\n${line.sku}`,
    ...(input.visibleFields.has('line_quantity') ? [line.quantity] : []),
    line.unitCode,
    ...(input.visibleFields.has('line_unit_price') ? [line.unitPrice] : []),
    ...(input.visibleFields.has('line_total') ? [line.lineTotal] : []),
  ]) : [];
  const meta: RetailPrintPayload['meta'] = [];
  if (input.visibleFields.has('customer') && input.customer) meta.push({ label: 'Khách hàng', value: input.customer });
  if (input.visibleFields.has('warehouse') && input.warehouse) meta.push({ label: 'Kho bán', value: input.warehouse });
  if (input.visibleFields.has('document_date') && input.date) meta.push({ label: 'Ngày', value: input.date });
  return {
    documentType: 'SALES_ORDER',
    paper: input.paper,
    copies: safeCopies(input.copies),
    heading: input.heading ?? null,
    title: input.title,
    subtitle: input.subtitle ?? null,
    documentNumber: input.documentNumber ?? null,
    meta,
    columns,
    rows,
    totals: input.visibleFields.has('total_total') ? [{ label: 'Tổng cộng', value: input.total }] : [],
    footer: input.visibleFields.has('signatures') ? ['Người lập', 'Khách hàng'] : [],
  };
}

export function buildPrinterTestPayload(paper: PrinterPaper, copies: number): RetailPrintPayload {
  return {
    documentType: 'PRINTER_TEST',
    paper,
    copies: safeCopies(copies),
    heading: 'BÁN TẠI QUẦY',
    title: 'PHIẾU IN THỬ',
    subtitle: 'Kiểm tra khổ giấy và máy in',
    meta: [{ label: 'Khổ giấy', value: paper }],
    columns: [],
    rows: [],
    totals: [],
    footer: ['Nếu đọc rõ phiếu này, máy in đã sẵn sàng.'],
  };
}
