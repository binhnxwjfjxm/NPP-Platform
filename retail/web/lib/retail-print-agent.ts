'use client';

import { createIdempotencyKey } from '@npp/contracts';
import type { RetailPrintPayload } from './printer-bridge';

export type RetailPrintAgent = {
  id: string;
  name: string;
  status: 'ONLINE' | 'OFFLINE';
  lastSeenAt?: string | null;
  printerName?: string | null;
  paperWidthMm?: 58 | 80 | null;
};

export type RetailPrintJobState = {
  jobId: string;
  status: 'QUEUED' | 'CLAIMED' | 'COMPLETED' | 'FAILED';
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt?: string | null;
  completedAt?: string | null;
};

type Envelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean };
};

export class RetailPrintAgentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'RetailPrintAgentError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/retail/print-agent${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...Object.fromEntries(new Headers(init.headers ?? {}).entries()),
    },
  });
  const payload = await response.json().catch(() => null) as Envelope<T> | null;
  if (!response.ok || !payload || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    throw new RetailPrintAgentError(
      payload?.error?.code ?? 'RETAIL_PRINT_AGENT_REQUEST_FAILED',
      payload?.error?.message ?? 'Không thể kết nối Retail Print',
      payload?.error?.retryable === true || response.status >= 500,
    );
  }
  return payload.data as T;
}

export function listRetailPrintAgents() {
  return request<RetailPrintAgent[]>('/status');
}

export function pairRetailPrintAgent(pairingCode: string) {
  return request<RetailPrintAgent>('/pair', {
    method: 'POST',
    body: JSON.stringify({ pairingCode: pairingCode.trim().toUpperCase() }),
  });
}

export function createRetailPrintJob(
  agentId: string,
  payload: RetailPrintPayload,
  idempotencyKey = createIdempotencyKey('retail-print-job'),
) {
  return request<{ jobId: string; status: 'QUEUED' | 'CLAIMED' }>(`/agents/${encodeURIComponent(agentId)}/jobs`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ payload }),
  });
}


export async function submitRetailPrintJob(agentId: string, payload: RetailPrintPayload) {
  const idempotencyKey = createIdempotencyKey('retail-print-job');
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await createRetailPrintJob(agentId, payload, idempotencyKey);
    } catch (error) {
      lastError = error;
      if (!(error instanceof RetailPrintAgentError) || !error.retryable || attempt === 1) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    }
  }
  throw lastError;
}

export function getRetailPrintJob(jobId: string) {
  return request<RetailPrintJobState>(`/jobs/${encodeURIComponent(jobId)}`);
}

export async function waitForRetailPrintJob(jobId: string, timeoutMs = 20_000) {
  const deadline = Date.now() + Math.max(1_000, Math.min(timeoutMs, 30_000));
  while (Date.now() < deadline) {
    const state = await getRetailPrintJob(jobId);
    if (state.status === 'COMPLETED') return state;
    if (state.status === 'FAILED') {
      throw new RetailPrintAgentError(
        state.errorCode ?? 'PRINTER_SEND_FAILED',
        state.errorMessage ?? 'Retail Print không in được chứng từ',
        false,
      );
    }
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  throw new RetailPrintAgentError(
    'PRINT_STATUS_UNKNOWN',
    'Đã gửi lệnh in nhưng chưa nhận được xác nhận. Không tự in lại để tránh trùng phiếu.',
    false,
  );
}
