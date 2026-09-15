import { MarketReportsLocalPage } from "./MarketReportsLocalPage";

function text(value: unknown) {
  return String(Array.isArray(value) ? value[0] : value ?? "").trim();
}

export function MarketReportsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const focusSessionId = text(searchParams?.sessionId || searchParams?.session_id);
  return <MarketReportsLocalPage focusSessionId={focusSessionId} />;
}
