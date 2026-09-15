import { McpSessionsLocalPage } from "@/features/mcp/McpSessionsLocalPage";

export const dynamic = "force-dynamic";

const VN_TIME_ZONE = "Asia/Ho_Chi_Minh";

function vnDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: VN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((item) => item.type === "year")?.value || "";
  const month = parts.find((item) => item.type === "month")?.value || "";
  const day = parts.find((item) => item.type === "day")?.value || "";
  return `${year}-${month}-${day}`;
}

export default function McpSessionsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const filters = {
    dateFrom: String(searchParams.dateFrom || vnDate(-30)).slice(0, 10),
    dateTo: String(searchParams.dateTo || vnDate()).slice(0, 10),
    routeId: String(searchParams.routeId || ""),
    status: String(searchParams.status || "")
  };
  return <McpSessionsLocalPage key={Date.now()} filters={filters} />;
}
