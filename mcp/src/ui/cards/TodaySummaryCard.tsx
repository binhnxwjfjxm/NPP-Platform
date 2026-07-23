type SummaryPill = {
  label: string;
  value: string | number;
};

type TodaySummaryCardProps = {
  eyebrow: string;
  value: string | number;
  description: string;
  pills?: SummaryPill[];
  tone?: "dark" | "teal";
};

export function TodaySummaryCard({ eyebrow, value, description, pills = [], tone = "dark" }: TodaySummaryCardProps) {
  const classes = ["dashboard-today-card", tone === "teal" ? "mcp-session-hero" : null].filter(Boolean).join(" ");

  return (
    <section className={classes}>
      <div className="dashboard-today-main">
        <span>{eyebrow}</span>
        <h2>{value}</h2>
        <p>{description}</p>
      </div>

      {pills.length > 0 ? (
        <div className="dashboard-today-pills">
          {pills.map((pill) => (
            <strong key={pill.label}>{pill.value} {pill.label}</strong>
          ))}
        </div>
      ) : null}
    </section>
  );
}
