import { MarketReportsPage } from "@/features/market-reports/MarketReportsPage";
import { McpProposalsPage } from "@/features/management-proposals/McpProposalsPage";

export default function Page({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const view = Array.isArray(searchParams?.view) ? searchParams?.view[0] : searchParams?.view;
  const proposals = view === "proposals";
  return proposals ? <McpProposalsPage /> : <MarketReportsPage searchParams={searchParams} />;
}
