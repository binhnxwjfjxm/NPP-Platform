import { MarketReportsLocalPage } from "@/features/market-reports/MarketReportsLocalPage";
import { McpProposalsPage } from "@/features/management-proposals/McpProposalsPage";

function text(value: unknown) {
  return String(Array.isArray(value) ? value[0] : value ?? "").trim();
}

export default function Page({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const view = text(searchParams?.view);
  if (view === "proposals") return <McpProposalsPage />;
  const focusSessionId = text(searchParams?.sessionId || searchParams?.session_id);
  return <MarketReportsLocalPage focusSessionId={focusSessionId} />;
}
