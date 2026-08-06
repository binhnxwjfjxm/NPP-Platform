import { redirect } from "next/navigation";
import { AppShell } from "@/ui/shell/AppShell";
import { McpOfficialOrderPanel } from "@/features/mcp/McpOfficialOrderPanel";

type PageProps = {
  searchParams?: {
    sessionCustomerId?: string;
    orderId?: string;
    customerName?: string;
    returnTo?: string;
  };
};

function safeVisitReturnTo(value?: string) {
  const candidate = String(value || "").trim();
  if (!candidate) return "/visits";

  try {
    const base = "https://mcp.local";
    const url = new URL(candidate, base);
    if (url.origin !== base || url.pathname !== "/visits") return "/visits";
    return `${url.pathname}${url.search}`;
  } catch {
    return "/visits";
  }
}

export default function Page({ searchParams }: PageProps) {
  const sessionCustomerId = String(searchParams?.sessionCustomerId || "").trim();
  const orderId = String(searchParams?.orderId || "").trim();
  const customerName = String(searchParams?.customerName || "").trim();
  const returnTo = safeVisitReturnTo(searchParams?.returnTo);

  if (!sessionCustomerId || !orderId) redirect(returnTo);

  return (
    <AppShell activeHref="/visits/order-intent">
      <McpOfficialOrderPanel
        sessionCustomerId={sessionCustomerId}
        orderId={orderId}
        customerName={customerName || undefined}
        returnTo={returnTo}
      />
    </AppShell>
  );
}
