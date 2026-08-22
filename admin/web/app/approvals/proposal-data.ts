import { CoreApiError, requestCore } from '../../lib/core-api';

export type ProposalDomain = 'commercial' | 'customer-debt' | 'operations' | 'mcp';
export type ProposalState = 'pending' | 'needs-info' | 'approved' | 'rejected';
export type ProposalPriority = 'critical' | 'high' | 'normal';
export type ProposalSource = 'company' | 'mcp';

export type ProposalEvent = {
  id: string;
  eventType: 'submitted' | 'decision' | 'resubmitted';
  fromStatus: ProposalState | null;
  toStatus: ProposalState;
  actorLabel: string;
  note: string | null;
  occurredAt: string;
};

export type ProposalItem = {
  id: string;
  source: ProposalSource;
  domain: ProposalDomain;
  title: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  impact: string;
  reason: string;
  rule: string;
  evidence: string[];
  priority: ProposalPriority;
  status: ProposalState;
  requesterName: string;
  requesterEmployeeId: string | null;
  decisionNote: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  history: ProposalEvent[];
};

export const proposalDomainLabel: Record<ProposalDomain, string> = {
  commercial: 'Thương mại',
  'customer-debt': 'Khách hàng & công nợ',
  operations: 'Ngoại lệ vận hành',
  mcp: 'MCP',
};

export const proposalStateLabel: Record<ProposalState, string> = {
  pending: 'Chờ quyết định',
  'needs-info': 'Chờ bổ sung',
  approved: 'Đã đồng ý',
  rejected: 'Đã từ chối',
};

export const proposalSourceLabel: Record<ProposalSource, string> = {
  company: 'Công Ty',
  mcp: 'MCP',
};

const DOMAINS = new Set(Object.keys(proposalDomainLabel));
const STATES = new Set(Object.keys(proposalStateLabel));
const SOURCES = new Set(Object.keys(proposalSourceLabel));
const PRIORITIES = new Set(['critical', 'high', 'normal']);
const EVENT_TYPES = new Set(['submitted', 'decision', 'resubmitted']);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function validEvent(value: unknown): value is ProposalEvent {
  const row = record(value);
  return Boolean(row
    && typeof row.id === 'string'
    && EVENT_TYPES.has(String(row.eventType ?? ''))
    && (row.fromStatus === null || STATES.has(String(row.fromStatus ?? '')))
    && STATES.has(String(row.toStatus ?? ''))
    && typeof row.actorLabel === 'string'
    && nullableString(row.note)
    && typeof row.occurredAt === 'string');
}

function validProposal(value: unknown): value is ProposalItem {
  const row = record(value);
  return Boolean(row
    && typeof row.id === 'string'
    && SOURCES.has(String(row.source ?? ''))
    && DOMAINS.has(String(row.domain ?? ''))
    && typeof row.title === 'string'
    && typeof row.entityType === 'string'
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
    && nullableString(row.requesterEmployeeId)
    && nullableString(row.decisionNote)
    && Number.isInteger(row.version)
    && Number(row.version) >= 1
    && typeof row.createdAt === 'string'
    && typeof row.updatedAt === 'string'
    && nullableString(row.decidedAt)
    && Array.isArray(row.history)
    && row.history.every(validEvent));
}

function responseInvalid(): never {
  throw new CoreApiError('ADMIN_PROPOSAL_RESPONSE_INVALID', 'Dữ liệu đề xuất không hợp lệ', 502, false);
}

export async function loadProposals(): Promise<ProposalItem[]> {
  const data = await requestCore<{ proposals?: unknown }>('/api/management-proposals');
  if (!Array.isArray(data.proposals) || !data.proposals.every(validProposal)) responseInvalid();
  return data.proposals;
}

export async function loadProposal(id: string): Promise<ProposalItem> {
  if (!/^[A-Za-z0-9._-]{1,240}$/.test(id)) {
    throw new CoreApiError('INVALID_PROPOSAL_ID', 'Mã đề xuất không hợp lệ', 400, false);
  }
  const data = await requestCore<unknown>(`/api/management-proposals/${encodeURIComponent(id)}`);
  if (!validProposal(data)) responseInvalid();
  return data;
}

export function formatProposalDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(parsed);
}

export function proposalWaitingAge(item: ProposalItem, now = Date.now()): string {
  if (item.status === 'approved' || item.status === 'rejected') return 'Đã hoàn tất';
  const started = Date.parse(item.updatedAt);
  if (!Number.isFinite(started)) return '—';
  const minutes = Math.max(0, Math.floor((now - started) / 60_000));
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} giờ ${rest} phút` : `${hours} giờ`;
  const days = Math.floor(hours / 24);
  return `${days} ngày`;
}
