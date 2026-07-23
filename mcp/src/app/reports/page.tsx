import { MarketReportsPage } from "@/features/market-reports/MarketReportsPage";

export default function Page({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  return <MarketReportsPage searchParams={searchParams} />;
}