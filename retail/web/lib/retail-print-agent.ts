'use client';

import { createIdempotencyKey } from '@npp/contracts';
import type { RetailPrintPayload } from './printer-bridge';

export type RetailPrintAgent = {
  id: string;
  name: string;
  status: 'ONLINE' | 'OFFLINE';
  lastSeenAt?: string | null;
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
  return request<{ jobId: string; status: 'QUEUED' }>(`/agents/${encodeURIComponent(agentId)}/jobs`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ payload }),
  });
}
