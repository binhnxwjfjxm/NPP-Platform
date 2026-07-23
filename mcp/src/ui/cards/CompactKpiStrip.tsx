import { KpiCard } from "./KpiCard";

type CompactKpiItem = {
  label: string;
  value: string | number;
  hint?: string;
};

type CompactKpiStripProps = {
  items: CompactKpiItem[];
  className?: string;
};

export function CompactKpiStrip({ items, className }: CompactKpiStripProps) {
  const classes = ["dashboard-kpi-strip", className].filter(Boolean).join(" ");

  return (
    <section className={classes} aria-label="Chỉ số nhanh">
      {items.map((item) => (
        <KpiCard key={item.label} label={item.label} value={item.value} hint={item.hint} />
      ))}
    </section>
  );
}
