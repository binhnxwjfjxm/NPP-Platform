type KpiCardProps = {
  label: string;
  value: string | number;
  hint?: string;
};

export function KpiCard({ label, value, hint }: KpiCardProps) {
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div className="card-value">{value}</div>
      {hint ? <p className="card-hint">{hint}</p> : null}
    </div>
  );
}
