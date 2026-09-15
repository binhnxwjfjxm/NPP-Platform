import { normalizeReportPeriod, resolveReportRange, type ReportDomain } from "./report-data";
import { ReportsLocal } from "./ReportsLocal";

const tabs: ReportDomain[] = ["executive", "debt", "inventory", "delivery-cod", "mcp", "people", "decisions"];
const warehouseFilterDomains = new Set<ReportDomain>(["debt", "inventory", "delivery-cod"]);

export default function ReportsPage({ searchParams }: { searchParams?: { tab?: string; period?: string; warehouseId?: string } }) {
  const selected = tabs.includes(searchParams?.tab as ReportDomain) ? searchParams?.tab as ReportDomain : "executive";
  const period = normalizeReportPeriod(searchParams?.period);
  const warehouseId = warehouseFilterDomains.has(selected) ? searchParams?.warehouseId ?? null : null;
  const range = resolveReportRange(period);
  return <ReportsLocal selected={selected as "executive" | "debt" | "inventory" | "delivery-cod" | "mcp" | "people" | "decisions"} period={period} warehouseId={warehouseId} from={range.from} to={range.to} />;
}
