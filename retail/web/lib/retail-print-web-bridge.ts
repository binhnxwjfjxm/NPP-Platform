'use client';

import type { RetailPrintPayload } from './printer-bridge';
import {
  listRetailPrintAgents,
  submitRetailPrintJob,
  waitForRetailPrintJob,
  type RetailPrintAgent,
} from './retail-print-agent';

type PrinterProfile = {
  id: string;
  name: string;
  connectionType: 'LAN';
  protocol: 'ESC_POS';
  host: null;
  port: null;
  paper: '80mm' | '58mm';
  lastVerifiedAt?: string | null;
  lastVerifiedStatus: 'READY' | 'OFFLINE';
};

type BridgeRequest = {
  action: 'capabilities' | 'discover' | 'test' | 'print' | 'forget';
  payload?: unknown;
};

type BridgeResponse = {
  ok: boolean;
  data?: unknown;
  code?: string;
  message?: string;
  safeToFallback?: boolean;
};

type WindowsProfilePayload = {
  profile?: { id?: unknown; paper?: unknown };
  payload?: RetailPrintPayload;
};

type WebBridge = {
  version: string;
  request(request: BridgeRequest): Promise<BridgeResponse>;
};

const PROFILE_PREFIX = 'windows-agent:';

function profileFromAgent(agent: RetailPrintAgent): PrinterProfile {
  const paper = agent.paperWidthMm === 58 ? '58mm' : '80mm';
  return {
    id: `${PROFILE_PREFIX}${agent.id}`,
    name: agent.printerName ? `${agent.name} · ${agent.printerName}` : agent.name,
    connectionType: 'LAN',
    protocol: 'ESC_POS',
    host: null,
    port: null,
    paper,
    lastVerifiedAt: agent.lastSeenAt ?? null,
    lastVerifiedStatus: agent.status === 'ONLINE' ? 'READY' : 'OFFLINE',
  };
}

function agentIdFromProfile(value: unknown) {
  const id = String((value as { id?: unknown } | null)?.id ?? '');
  if (!id.startsWith(PROFILE_PREFIX)) return '';
  const agentId = id.slice(PROFILE_PREFIX.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(agentId) ? agentId : '';
}

async function printThroughWindows(input: WindowsProfilePayload) {
  const agentId = agentIdFromProfile(input.profile);
  const payload = input.payload;
  if (!agentId || !payload) {
    return { ok: false, code: 'PRINT_AGENT_NOT_SELECTED', message: 'Chưa chọn Retail Print trên máy Windows.', safeToFallback: true } satisfies BridgeResponse;
  }
  if (!['80mm', '58mm'].includes(String(payload.paper))) {
    return { ok: false, code: 'PRINT_PAPER_NOT_SUPPORTED', message: 'Retail Print trên Windows dùng khổ 80 mm hoặc 58 mm.', safeToFallback: true } satisfies BridgeResponse;
  }
  try {
    const queued = await submitRetailPrintJob(agentId, payload);
    const completed = await waitForRetailPrintJob(queued.jobId);
    return {
      ok: true,
      data: {
        printedCopies: Math.max(1, Math.min(5, Number(payload.copies) || 1)),
        verifiedAt: completed.completedAt ?? new Date().toISOString(),
      },
    } satisfies BridgeResponse;
  } catch (error) {
    const value = error as { code?: string; message?: string };
    const safeToFallback = value?.code === 'PRINT_AGENT_OFFLINE' || value?.code === 'PRINT_AGENT_NOT_FOUND';
    return {
      ok: false,
      code: value?.code ?? 'RETAIL_PRINT_FAILED',
      message: value?.message ?? 'Retail Print không thực hiện được lệnh in.',
      safeToFallback,
    } satisfies BridgeResponse;
  }
}

const webBridge: WebBridge = {
  version: 'retail-print-windows/1',
  async request(request) {
    if (request.action === 'capabilities') {
      return {
        ok: true,
        data: {
          version: 'retail-print-windows/1',
          directWifi: true,
          discovery: true,
          manualIp: false,
          protocols: ['ESC_POS'],
          cashDrawer: false,
        },
      };
    }
    if (request.action === 'discover') {
      try {
        const agents = await listRetailPrintAgents();
        return { ok: true, data: agents.map(profileFromAgent) };
      } catch (error) {
        const value = error as { code?: string; message?: string };
        return { ok: false, code: value?.code ?? 'RETAIL_PRINT_DISCOVERY_FAILED', message: value?.message ?? 'Chưa thể tải Retail Print đã kết nối.', safeToFallback: true };
      }
    }
    if (request.action === 'test' || request.action === 'print') {
      return printThroughWindows((request.payload ?? {}) as WindowsProfilePayload);
    }
    if (request.action === 'forget') return { ok: true, data: null };
    return { ok: false, code: 'UNSUPPORTED_PRINT_ACTION', message: 'Thao tác in chưa được hỗ trợ.', safeToFallback: true };
  },
};

if (typeof window !== 'undefined') {
  const target = window as Window & { RetailPrinterBridge?: WebBridge };
  if (!target.RetailPrinterBridge) target.RetailPrinterBridge = webBridge;
}
