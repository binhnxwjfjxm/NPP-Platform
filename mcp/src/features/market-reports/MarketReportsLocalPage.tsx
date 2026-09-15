"use client";

import { useMcpLocalResource } from "@/lib/local-read/use-mcp-local-resource";
import { MarketReportsClientPage } from "./MarketReportsClientPage";
import type { MarketReportsLocalData } from "./market-reports-local-data";

const EMPTY_DATA: MarketReportsLocalData = { kpis: [], reports: [] };

export function MarketReportsLocalPage({ focusSessionId }: { focusSessionId: string }) {
  const read = useMcpLocalResource<MarketReportsLocalData>("reports");
  const data = read.data ?? EMPTY_DATA;
  return <MarketReportsClientPage kpis={data.kpis} reports={data.reports} focusSessionId={focusSessionId} />;
}
