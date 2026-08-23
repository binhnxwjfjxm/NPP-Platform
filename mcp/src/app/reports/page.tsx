import { MarketReportsPage } from "@/features/market-reports/MarketReportsPage";
import { ReportsModeTabs } from "@/features/market-reports/ReportsModeTabs";
import { McpProposalsPage } from "@/features/management-proposals/McpProposalsPage";

export default function Page({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const view = Array.isArray(searchParams?.view) ? searchParams?.view[0] : searchParams?.view;
  const proposals = view === "proposals";
  return (
    <>
      <ReportsModeTabs active={proposals ? "proposals" : "reports"} />
      {proposals ? <McpProposalsPage /> : <MarketReportsPage searchParams={searchParams} />}
    </>
  );
}
