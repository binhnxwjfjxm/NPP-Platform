import 'server-only';
import { randomUUID } from 'node:crypto';
import {
  createIdempotencyKey,
  isValidIdempotencyKey,
  normalizeIdempotencyKey,
} from '@npp/contracts';
import { requireNppWorkforceSessionToken } from './internal-auth-client';

const REQUEST_TIMEOUT_MS = 8_000;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const SAFE_ID = /^[A-Za-z0-9._-]{1,240}$/;
const DOMAINS = new Set(['commercial', 'customer-debt', 'operations']);
const PRIORITIES = new Set(['critical', 'high', 'normal']);
const ENTITY_TYPES = new Set(['customer', 'sales-order', 'purchase-order', 'document', 'route', 'employee', 'outlet', 'other']);
const STATES = new Set(['pending', 'needs-info', 'approved', 'rejected']);

type CoreEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
};

export type ManagementProposalState = 'pending' | 'needs-info' | 'approved' | 'rejected';
export type ManagementProposalPriority = 'critical' | 'high' | 'normal';
export type ManagementProposalDomain = 'commercial' | 'customer-debt' | 'operations';

export type ManagementProposalItem = {
  id: string;
  source: 'company';
  domain: ManagementProposalDomain;
  title: string;
  content: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  impact: string;
  reason: string;
  rule: string;
  evidence: string[];
  priority: ManagementProposalPriority;
  status: ManagementProposalState;
  requesterName: string;
  decisionNote: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
};

export class ManagementProposalGatewayError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly details: unknown = {},
  ) {
    super(publicMessage);
    this.name = 'ManagementProposalGatewayError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isProposal(value: unknown): value is ManagementProposalItem {
  const row = record(value);
  return Boolean(row
    && typeof row.id === 'string'
    && row.source === 'company'
    && DOMAINS.has(String(row.domain ?? ''))
    && typeof row.title === 'string'
    && typeof row.content === 'string'
    && ENTITY_TYPES.has(String(row.entityType ?? ''))
    && typeof row.entityId === 'string'
    && typeof row.entityLabel === 'string'
    && typeof row.impact === 'string'
    && typeof row.reason === 'string'
    && typeof row.rule === 'string'
    && Array.isArray(row.evidence)
    && row.evidence.every((item) => typeof item === 'string')
    && PRIORITIES.has(String(row.priority ?? ''))
    && STATES.has(String(row.status ?? ''))
    && typeof row.requesterName === 'string'
    && nullableString(row.decisionNote)
    && Number.isInteger(row.version)
    && typeof row.createdAt === 'string'
    && typeof row.updatedAt === 'string'
    && nullableString(row.decidedAt));
}

function baseUrl() {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) throw new ManagementProposalGatewayError('MANAGEMENT_PROPOSAL_NOT_CONFIGURED', 'Kết nối Đề xuất chưa được cấu hình', 503, false);
  let url: URL;
  try { url = new URL(raw); } catch {
    throw new ManagementProposalGatewayError('MANAGEMENT_PROPOSAL_NOT_CONFIGURED', 'Kết nối Đề xuất chưa được cấu hình', 503, false);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new ManagementProposalGatewayError('MANAGEMENT_PROPOSAL_NOT_CONFIGURED', 'Kết nối Đề xuất chưa được cấu hình', 503, false);
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function mutationKey(value: string | undefined, operation: string) {
  const normalized = normalizeIdempotencyKey(value || createIdempotencyKey(operation));
  if (!normalized || !isValidIdempotencyKey(normalized)) {
    throw new ManagementProposalGatewayError('INVALID_IDEMPOTENCY_KEY', 'Khóa chống xử lý trùng không hợp lệ', 400, false);
  }
  return normalized;
}

function proposalId(value: string) {
  const normalized = value.trim();
  if (!SAFE_ID.test(normalized)) {
    throw new ManagementProposalGatewayError('INVALID_PROPOSAL_ID', 'Mã đề xuất không hợp lệ', 400, false);
  }
  return normalized;
}

async function requestCore<T>({
  method,
  path,
  requestId,
  body,
  idempotencyKey,
}: {
  method: 'GET' | 'POST';
  path: string;
  requestId: string;
  body?: unknown;
  idempotencyKey?: string;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl()}${path}`, {
      method,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${requireNppWorkforceSessionToken()}`,
        Accept: 'application/json',
        'X-Request-Id': requestId,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => null) as CoreEnvelope<T> | null;
    if (!payload) throw new ManagementProposalGatewayError('MANAGEMENT_PROPOSAL_RESPONSE_INVALID', 'Phản hồi Đề xuất không hợp lệ', 502, false);
    if (!response.ok) {
      throw new ManagementProposalGatewayError(
        payload.error?.code || 'MANAGEMENT_PROPOSAL_REQUEST_FAILED',
        payload.error?.message || 'Yêu cầu Đề xuất không thành công',
        response.status,
        payload.error?.retryable === true,
        payload.error?.details ?? {},
      );
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new ManagementProposalGatewayError('MANAGEMENT_PROPOSAL_RESPONSE_INVALID', 'Phản hồi Đề xuất không hợp lệ', 502, false);
    }
    return payload.data as T;
  } catch (error) {
    if (error instanceof ManagementProposalGatewayError) throw error;
    throw new ManagementProposalGatewayError('MANAGEMENT_PROPOSAL_UNAVAILABLE', 'Đề xuất tạm thời chưa sẵn sàng', 503, true);
  } finally {
    clearTimeout(timeout);
  }
}

export function resolveManagementProposalRequestId(value?: string | null) {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `web_${randomUUID()}`;
}

export async function listOwnManagementProposals(requestId: string): Promise<ManagementProposalItem[]> {
  const data = await requestCore<{ proposals?: unknown }>({
    method: 'GET',
    path: '/api/management-proposals?source=company',
    requestId,
  });
  if (!Array.isArray(data.proposals) || !data.proposals.every(isProposal)) {
    throw new ManagementProposalGatewayError('MANAGEMENT_PROPOSAL_RESPONSE_INVALID', 'Phản hồi Đề xuất không hợp lệ', 502, false);
  }
  return data.proposals;
}

export async function createManagementProposal(input: {
  domain: ManagementProposalDomain;
  title: string;
  content: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  impact: string;
  reason: string;
  rule: string;
  evidence: string[];
  priority: ManagementProposalPriority;
}, requestId: string, idempotencyKey?: string) {
  const data = await requestCore<unknown>({
    method: 'POST',
    path: '/api/management-proposals',
    requestId,
    idempotencyKey: mutationKey(idempotencyKey, 'company-management-proposal'),
    body: { ...input, source: 'company' },
  });
  if (!isProposal(data)) throw new ManagementProposalGatewayError('MANAGEMENT_PROPOSAL_RESPONSE_INVALID', 'Phản hồi Đề xuất không hợp lệ', 502, false);
  return data;
}

export async function resubmitManagementProposal(input: {
  id: string;
  content: string;
  reason: string;
  evidence: string[];
}, requestId: string, idempotencyKey?: string) {
  const data = await requestCore<unknown>({
    method: 'POST',
    path: `/api/management-proposals/${encodeURIComponent(proposalId(input.id))}/resubmit`,
    requestId,
    idempotencyKey: mutationKey(idempotencyKey, 'company-management-proposal-resubmit'),
    body: { content: input.content, reason: input.reason, evidence: input.evidence },
  });
  if (!isProposal(data)) throw new ManagementProposalGatewayError('MANAGEMENT_PROPOSAL_RESPONSE_INVALID', 'Phản hồi Đề xuất không hợp lệ', 502, false);
  return data;
}
