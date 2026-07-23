import { AppShell } from "@/ui/shell/AppShell";

function SkeletonCard({ tall = false }: { tall?: boolean }) {
  return <div className={tall ? "card skeleton-card skeleton-card-tall" : "card skeleton-card"} />;
}

export default function Loading() {
  return (
    <AppShell activeHref="/visits">
      <section className="loading-page" aria-busy="true" aria-label="Dang tai MCP hom nay">
        <div className="skeleton-line skeleton-eyebrow" />
        <div className="skeleton-line skeleton-title" />
        <div className="skeleton-line skeleton-subtitle" />

        <SkeletonCard tall />

        <div className="dashboard-kpi-grid">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>

        <div className="mcp-status-chips">
          <span className="skeleton-pill" />
          <span className="skeleton-pill" />
          <span className="skeleton-pill" />
          <span className="skeleton-pill" />
        </div>

        <div className="mcp-line-list">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </section>
    </AppShell>
  );
}
