import 'server-only';

import { CoreApiError, requestCore } from './core-api';

export type AiUsageSource = 'admin' | 'website' | 'ordering';

export type AiUsageFilters = {
  customerId?: string;
  source?: AiUsageSource | '';
  model?: string;
  from?: string;
  to?: string;
};

export type AiUsageCredit = {
  limitUsd: string;
  usedUsd: string;
  remainingUsd: string;
  usagePercent: string;
};

export type AiUsageBreakdown = {
  eventCount: number;
  promptTokens: number;
  cachedTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  toolUsePromptTokens: number;
  totalTokens: number;
  usageUsd: string;
};

export type AiUsageSourceBreakdown = AiUsageBreakdown & { source: AiUsageSource };
export type AiUsageModelBreakdown = AiUsageBreakdown & { model: string };

export type AiCustomerUsage = AiUsageBreakdown & {
  customerId: string;
  customerCode: string;
  customerName: string;
  periodUsageUsd: string;
  limitUsd: string;
  usedUsd: string;
  remainingUsd: string;
  usagePercent: string;
};

export type AiUsageSummary = AiUsageBreakdown & {
  credit: AiUsageCredit | null;
  sourceBreakdown: AiUsageSourceBreakdown[];
  modelBreakdown: AiUsageModelBreakdown[];
  customerBreakdown: AiCustomerUsage[];
};

export type AiUsageEvent = {
  id: string;
  customerId: string | null;
  source: AiUsageSource;
  feature: string;
  provider: string;
  model: string;
  promptTokens: number;
  cachedTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  toolUsePromptTokens: number;
  totalTokens: number;
  usageUsd: string;
  rateCardVersion: string;
  occurredAt: string;
};

export type AiUsageEventPage = {
  events: AiUsageEvent[];
  limit: number;
  offset: number;
};

type JsonRecord = Record<string, unknown>;

const sources = new Set<AiUsageSource>(['admin', 'website', 'ordering']);
const decimalPattern = /^-?\d+(?:\.\d+)?$/;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(row: JsonRecord, key: string): string {
  const value = row[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new CoreApiError('ADMIN_AI_USAGE_RESPONSE_INVALID', 'Số liệu sử dụng AI không hợp lệ', 502, false);
  }
  return value;
}

function decimalString(row: JsonRecord, key: string, fallback = '0'): string {
  const value = row[key];
  if (value === undefined || value === null || value === '') return fallback;
  const text = String(value);
  if (!decimalPattern.test(text)) {
    throw new CoreApiError('ADMIN_AI_USAGE_RESPONSE_INVALID', 'Số liệu sử dụng AI không hợp lệ', 502, false);
  }
  return text;
}

function integerValue(row: JsonRecord, key: string): number {
  const value = Number(row[key] ?? 0);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CoreApiError('ADMIN_AI_USAGE_RESPONSE_INVALID', 'Số liệu sử dụng AI không hợp lệ', 502, false);
  }
  return value;
}

function tokenFields(row: JsonRecord): AiUsageBreakdown {
  return {
    eventCount: integerValue(row, 'eventCount'),
    promptTokens: integerValue(row, 'promptTokens'),
    cachedTokens: integerValue(row, 'cachedTokens'),
    outputTokens: integerValue(row, 'outputTokens'),
    thinkingTokens: integerValue(row, 'thinkingTokens'),
    toolUsePromptTokens: integerValue(row, 'toolUsePromptTokens'),
    totalTokens: integerValue(row, 'totalTokens'),
    usageUsd: decimalString(row, 'usageUsd'),
  };
}

function normalizeCredit(value: unknown): AiUsageCredit | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) {
    throw new CoreApiError('ADMIN_AI_USAGE_RESPONSE_INVALID', 'Hạn mức AI không hợp lệ', 502, false);
  }
  return {
    limitUsd: decimalString(value, 'limitUsd'),
    usedUsd: decimalString(value, 'usedUsd'),
    remainingUsd: decimalString(value, 'remainingUsd'),
    usagePercent: decimalString(value, 'usagePercent'),
  };
}

function normalizeSourceBreakdown(value: unknown): AiUsageSourceBreakdown[] {
  if (!Array.isArray(value)) {
    throw new CoreApiError('ADMIN_AI_USAGE_RESPONSE_INVALID', 'Phân bổ mức sử dụng AI không hợp lệ', 502, false);
  }
  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw new CoreApiError('ADMIN_AI_USAGE_RESPONSE_INVALID', 'Phân bổ mức sử dụng AI không hợp lệ', 502, false);
    }
    const source = requiredString(entry, 'source') as AiUsageSource;
    if (!sources.has(source)) {
      throw new CoreApiError('ADMIN_AI_USAGE_RESPONSE_INVALID', 'Nguồn sử dụng AI không hợp lệ', 502, false);
    }
    return { source, ...tokenFields(entry) };
  });
}

function normalizeModelBreakdown(value: unknown): AiUsageModelBreakdown[] {
  if (!Array.isArray(value)) {
    throw new CoreApiError('ADMIN_AI_USAGE_RESPONSE_INVALID', 'Phân bổ model AI không hợp lệ', 502, false);
  }
  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw new CoreApiError('ADMIN_AI_USAGE_RESPONSE_INVALID', 'Phân bổ model AI không hợp lệ', 502, false);
    }
    return { model: requiredString(entry, 'model'), ...tokenFields(entry) };
  });
}

function normalizeCustomerBreakdown(value: unknown): AiCustomerUsage[] {
  if (!Array.isArray(value)) {
    throw new CoreApiError('ADMIN_AI_USAGE_RESPONSE_INVALID', 'Mức sử dụng AI theo khách không hợp lệ', 502, false);
  }
  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw new CoreApiError('ADMIN_AI_USAGE_RESPONSE_INVALID', 'Mức sử dụng AI theo khách không hợp lệ', 502, false);
    }
    return {
      customerId: requiredString(entry, 'customerId'),
      customerCode: requiredString(entry, 'customerCode'),
      customerName: requiredString(entry, 'customerName'),
      ...tokenFields({
        ...entry,
        usageUsd: entry.periodUsageUsd,
      }),
      periodUsageUsd: decimalString(entry, 'periodUsageUsd'),
      limitUsd: decimalString(entry, 'limitUsd', '1000.00'),
      usedUsd: decimalString(entry, 'usedUsd'),
      remainingUsd: decimalString(entry, 'remainingUsd'),
      usagePercent: decimalString(entry, 'usagePercent'),
    };
  });
}

function normalizeSummary(value: unknown): AiUsageSummary {
  if (!isRecord(value)) {
    throw new CoreApiError('ADMIN_AI_USAGE_RESPONSE_INVALID', 'Số liệu sử dụng AI không hợp lệ', 502, false);
  }
  return {
    ...tokenFields(value),
    credit: normalizeCredit(value.credit),
    sourceBreakdown: normalizeSourceBreakdown(value.sourceBreakdown),
    modelBreakdown: normalizeModelBreakdown(value.modelBreakdown),
    customerBreakdown: normalizeCustomerBreakdown(value.customerBreakdown),
  };
}

function normalizeEvent(value: unknown): AiUsageEvent {
  if (!isRecord(value)) {
    throw new CoreApiError('ADMIN_AI_USAGE_RESPONSE_INVALID', 'Lịch sử sử dụng AI không hợp lệ', 502, false);
  }
  const source = requiredString(value, 'source') as AiUsageSource;
  if (!sources.has(source)) {
    throw new CoreApiError('ADMIN_AI_USAGE_RESPONSE_INVALID', 'Nguồn sử dụng AI không hợp lệ', 502, false);
  }
  const customerId = value.customerId === null ? null : requiredString(value, 'customerId');
  return {
    id: requiredString(value, 'id'),
    customerId,
    source,
    feature: requiredString(value, 'feature'),
    provider: requiredString(value, 'provider'),
    model: requiredString(value, 'model'),
    promptTokens: integerValue(value, 'promptTokens'),
    cachedTokens: integerValue(value, 'cachedTokens'),
    outputTokens: integerValue(value, 'outputTokens'),
    thinkingTokens: integerValue(value, 'thinkingTokens'),
    toolUsePromptTokens: integerValue(value, 'toolUsePromptTokens'),
    totalTokens: integerValue(value, 'totalTokens'),
    usageUsd: decimalString(value, 'usageUsd'),
    rateCardVersion: requiredString(value, 'rateCardVersion'),
    occurredAt: requiredString(value, 'occurredAt'),
  };
}

function buildQuery(filters: AiUsageFilters, extra: Record<string, string> = {}): string {
  const query = new URLSearchParams();
  if (filters.customerId) query.set('customerId', filters.customerId);
  if (filters.source) query.set('source', filters.source);
  if (filters.model) query.set('model', filters.model);
  if (filters.from) query.set('from', filters.from);
  if (filters.to) query.set('to', filters.to);
  for (const [key, value] of Object.entries(extra)) query.set(key, value);
  const text = query.toString();
  return text ? `?${text}` : '';
}

export async function loadAiUsageSummary(filters: AiUsageFilters = {}): Promise<AiUsageSummary> {
  const value = await requestCore<unknown>(`/api/ai/usage-summary${buildQuery(filters)}`);
  return normalizeSummary(value);
}

export async function loadAiUsageEvents(
  filters: AiUsageFilters = {},
  limit = 50,
  offset = 0,
): Promise<AiUsageEventPage> {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const safeOffset = Math.max(0, Math.trunc(offset));
  const value = await requestCore<unknown>(`/api/ai/usage-events${buildQuery(filters, {
    limit: String(safeLimit),
    offset: String(safeOffset),
  })}`);
  if (!isRecord(value) || !Array.isArray(value.events)) {
    throw new CoreApiError('ADMIN_AI_USAGE_RESPONSE_INVALID', 'Lịch sử sử dụng AI không hợp lệ', 502, false);
  }
  return {
    events: value.events.map(normalizeEvent),
    limit: integerValue(value, 'limit'),
    offset: integerValue(value, 'offset'),
  };
}
