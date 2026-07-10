type KpiCardProps = {
  label: string;
  value: string | number;
  trend?: string;
  tone?: "good" | "warn" | "bad" | "neutral";
};

export function KpiCard({ label, value, trend, tone = "neutral" }: KpiCardProps) {
  return (
    <article className={`kpi-card tone-${tone}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {trend ? <div className="kpi-trend">{trend}</div> : null}
    </article>
  );
}
