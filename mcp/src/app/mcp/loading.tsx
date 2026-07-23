import { AppShell } from "@/ui/shell/AppShell";

function SkeletonCard({ tall = false }: { tall?: boolean }) {
  return <div className={tall ? "card skeleton-card skeleton-card-tall" : "card skeleton-card"} />;
}

export default function Loading() {
  return (
    <AppShell activeHref="/mcp">
      <section className="loading-page" aria-busy="true" aria-label="Dang tai MCP">
        <div className="skeleton-line skeleton-eyebrow" />
        <div className="skeleton-line skeleton-title" />
        <div className="skeleton-line skeleton-subtitle" />

        <SkeletonCard tall />

        <div className="dashboard-module-grid">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>

        <SkeletonCard />
        <SkeletonCard tall />
      </section>
    </AppShell>
  );
}
