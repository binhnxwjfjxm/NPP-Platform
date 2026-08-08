import 'server-only';
import { CoreApiError, requestCore } from './core-api';

type MetricRow = Record<string, unknown>;
type SummaryCard = { summary: MetricRow; currencyTotals?: MetricRow[] };

export type AdminControlTowerData = {
  generatedAt: string;
  timezone: string;
  filters: { from: string; to: string; warehouseId: string | null };
  management: {
    sales: SummaryCard | null;
    purchasing: SummaryCard | null;
    inventory: { summary: MetricRow; projectionState: MetricRow } | null;
    aging: { receivableSummary: MetricRow[]; payableSummary: MetricRow[] } | null;
    grossMargin: { summary: MetricRow } | null;
    employeeMcp: { summary: MetricRow } | null;
    logistics: { summary: MetricRow; dataQuality: { exceptions?: MetricRow[] } } | null;
    cod: {
      custodyByCurrency: MetricRow[];
      hasPendingHandovers: boolean;
      hasDiscrepancies: boolean;
      hasOverduePromises: boolean;
      hasLifecycleExceptions: boolean;
      hasCurrencyLineageExceptions: boolean;
    } | null;
  };
  warnings: Array<{ family: string; code: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export async function loadControlTower(): Promise<AdminControlTowerData> {
  const data = await requestCore<unknown>('/api/reporting/control-tower');
  if (!isRecord(data) || !isRecord(data.management) || !Array.isArray(data.warnings) || typeof data.generatedAt !== 'string' || typeof data.timezone !== 'string') {
    throw new CoreApiError('ADMIN_CONTROL_TOWER_RESPONSE_INVALID', 'Dữ liệu Control Tower không hợp lệ', 502, false);
  }
  return data as unknown as AdminControlTowerData;
}
