import { redirect } from "next/navigation";
import { AppShell } from "@/ui/shell/AppShell";
import { McpOfficialOrderPanel } from "@/features/mcp/McpOfficialOrderPanel";

type PageProps = {
  searchParams?: {
    sessionCustomerId?: string;
    orderId?: string;
    customerName?: string;
  };
};

export default function Page({ searchParams }: PageProps) {
  const sessionCustomerId = String(searchParams?.sessionCustomerId || "").trim();
  const orderId = String(searchParams?.orderId || "").trim();
  const customerName = String(searchParams?.customerName || "").trim();

  if (!sessionCustomerId || !orderId) redirect("/mcp");

  return (
    <AppShell activeHref="/visits">
      <McpOfficialOrderPanel
        sessionCustomerId={sessionCustomerId}
        orderId={orderId}
        customerName={customerName || undefined}
      />
    </AppShell>
  );
}
