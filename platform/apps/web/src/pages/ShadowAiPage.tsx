import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { DataTable, type Column } from "../components/DataTable";
import { DetailDrawer } from "../components/DetailDrawer";
import { KpiCard } from "../components/KpiCard";
import { apiRequest, compactDate, listFromPayload, numberAt, valueAt } from "../lib/api";

export function ShadowAiPage() {
  const navigate = useNavigate();
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string>("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<Record<string, unknown>>("/api/shadow-ai", { query: { limit: 300 } });
      setPayload(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Shadow AI findings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const findings = useMemo(
    () => listFromPayload<Record<string, unknown>>(payload, ["findings", "items", "agents"]),
    [payload]
  );

  const byTag = (payload?.byTag as Record<string, number> | undefined) || {};
  const tagEntries = Object.entries(byTag).sort((a, b) => b[1] - a[1]);

  const filtered = useMemo(() => {
    if (!tagFilter) return findings;
    return findings.filter((row) => {
      const tags = (row.shadowAiTags as string[] | undefined) || [];
      const risks = (row.risk_indicators as string[] | undefined) || [];
      return tags.includes(tagFilter) || risks.includes(tagFilter);
    });
  }, [findings, tagFilter]);

  const columns: Array<Column<Record<string, unknown>>> = [
    {
      key: "name",
      header: "Shadow AI asset",
      render: (row) => <strong>{valueAt(row, ["name", "displayName"])}</strong>,
      sortValue: (row) => valueAt(row, ["name", "displayName"])
    },
    {
      key: "category",
      header: "Category",
      render: (row) => <span className="badge">{valueAt(row, ["category"], "unknown")}</span>,
      sortValue: (row) => valueAt(row, ["category"])
    },
    {
      key: "score",
      header: "Shadow score",
      render: (row) => `${Math.round(numberAt(row, ["shadowAiScore", "score"], 0) * 100)}%`,
      sortValue: (row) => numberAt(row, ["shadowAiScore", "score"], 0)
    },
    {
      key: "owner",
      header: "Owner",
      render: (row) => valueAt(row, ["owner"], "— none —"),
      sortValue: (row) => valueAt(row, ["owner"], "")
    },
    {
      key: "reasons",
      header: "Why flagged",
      render: (row) => {
        const reasons = (row.shadowAiReasons as string[] | undefined) || [];
        return reasons.slice(0, 2).join("; ") || valueAt(row, ["queue"], "shadow_ai");
      },
      sortValue: (row) => String(((row.shadowAiReasons as string[]) || [])[0] || "")
    },
    {
      key: "last",
      header: "Last seen",
      render: (row) => compactDate(row.last_seen ?? row.lastObservedAt),
      sortValue: (row) => String(row.last_seen ?? row.lastObservedAt ?? "")
    }
  ];

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Visibility</p>
          <h1>Shadow AI</h1>
          <p className="page-description">
            Identify unsanctioned or unmanaged AI agents — ownerless IDE/local LLMs, consumer AI SaaS, browser
            assistants, and AI cloud resources without attribution. Visibility only; Visentra does not block or
            remediate.
          </p>
        </div>
        <div className="toolbar" style={{ gap: 8 }}>
          <Link className="button" to="/inventory?shadow=true">
            Open in Inventory
          </Link>
          <button className="button primary" type="button" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </header>

      {error ? <div className="error-state">{error}</div> : null}

      <section className="card-grid">
        <KpiCard label="Shadow AI findings" value={numberAt(payload || {}, ["total"], findings.length)} tone="warn" />
        <KpiCard label="Ownerless signals" value={byTag.ownerless || 0} tone="warn" />
        <KpiCard label="Consumer / SaaS shadow" value={(byTag.consumer_ai || 0) + (byTag.saas_shadow || 0)} />
        <KpiCard label="Local LLM / IDE" value={(byTag.local_llm_unmanaged || 0) + (byTag.ide_agent_unmanaged || 0)} />
      </section>

      {tagEntries.length ? (
        <div className="toolbar" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <button className={`button ${!tagFilter ? "primary" : "ghost"}`} type="button" onClick={() => setTagFilter("")}>
            All tags
          </button>
          {tagEntries.slice(0, 10).map(([tag, count]) => (
            <button
              key={tag}
              className={`button ${tagFilter === tag ? "primary" : "ghost"}`}
              type="button"
              onClick={() => setTagFilter(tag)}
            >
              {tag} ({count})
            </button>
          ))}
        </div>
      ) : null}

      <section className="panel">
        <div className="page-header">
          <h2>Shadow AI candidates</h2>
          <span className="status-pill">{filtered.length} results</span>
        </div>
        {loading ? (
          <div className="loading-state">Classifying Shadow AI inventory...</div>
        ) : (
          <DataTable
            columns={columns}
            rows={filtered}
            onRowClick={setSelected}
            emptyMessage="No Shadow AI findings yet. Run discovery (cloud, EDR, IDE/process) then refresh."
          />
        )}
      </section>

      <DetailDrawer
        data={selected}
        open={Boolean(selected)}
        title={selected ? valueAt(selected, ["name"], "Shadow AI asset") : "Shadow AI asset"}
        subtitle={
          selected
            ? ((selected.shadowAiReasons as string[] | undefined) || []).join(" · ") ||
              valueAt(selected, ["category"], "Shadow AI")
            : undefined
        }
        onClose={() => setSelected(null)}
      >
        {selected?.id ? (
          <button className="button primary" type="button" onClick={() => navigate(`/agents/${String(selected.id)}`)}>
            Open inventory detail
          </button>
        ) : null}
      </DetailDrawer>
    </div>
  );
}
