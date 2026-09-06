import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { AgentAnatomyPanel, type AgentAnatomy } from "../components/AgentAnatomyPanel";
import { AgentExecutionTopology } from "../components/AgentExecutionTopology";
import { GraphSeedBar, type GraphSeedOption } from "../components/GraphSeedBar";
import { apiRequest, type Agent, type GraphPayload, valueAt } from "../lib/api";

function looksLikeAgentId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function RelationshipExplorerPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [seed, setSeed] = useState(() => searchParams.get("agentId") || searchParams.get("seed") || "");
  const [depth, setDepth] = useState(2);
  const [seeds, setSeeds] = useState<GraphSeedOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [anatomy, setAnatomy] = useState<AgentAnatomy | null>(null);
  const [anatomyLoading, setAnatomyLoading] = useState(false);
  const [anatomyError, setAnatomyError] = useState<string | null>(null);
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(() => searchParams.get("agentId") || null);
  const [focusedAgent, setFocusedAgent] = useState<Agent | null>(null);

  const loadSeeds = async (q = "") => {
    try {
      const payload = await apiRequest<{ seeds?: GraphSeedOption[] }>("/api/graph/seeds", {
        query: { q: q || undefined }
      });
      setSeeds(payload.seeds || []);
    } catch {
      /* non-blocking */
    }
  };

  const loadAnatomy = async (agentId: string | null) => {
    if (!agentId) {
      setAnatomy(null);
      setAnatomyError(null);
      setFocusedAgentId(null);
      setFocusedAgent(null);
      return;
    }
    setAnatomyLoading(true);
    setAnatomyError(null);
    setFocusedAgentId(agentId);
    try {
      const [anatomyPayload, agentPayload] = await Promise.all([
        apiRequest<AgentAnatomy>(`/api/agents/${agentId}/anatomy`),
        apiRequest<{ agent?: Agent } | Agent>(`/api/agents/${agentId}`).catch(() => null)
      ]);
      setAnatomy(anatomyPayload);
      const agentRecord =
        agentPayload && typeof agentPayload === "object" && "agent" in agentPayload
          ? ((agentPayload as { agent?: Agent }).agent as Agent | undefined) || null
          : ((agentPayload as Agent | null) || null);
      setFocusedAgent(agentRecord);
    } catch (requestError) {
      setAnatomy(null);
      setFocusedAgent(null);
      setAnatomyError(requestError instanceof Error ? requestError.message : "Failed to load agent anatomy.");
    } finally {
      setAnatomyLoading(false);
    }
  };

  const resolveFocusedAgent = (payload: GraphPayload, nextSeed: string) => {
    if (looksLikeAgentId(nextSeed)) return nextSeed;
    const nodes = payload.nodes || [];
    const agents = nodes.filter((node) => {
      const type = String(node.type || node.category || "").toLowerCase();
      return type === "agent" || type.includes("agent");
    });
    if (agents.length === 1) return String(agents[0].id);
    if (payload.meta?.seed && looksLikeAgentId(String(payload.meta.seed))) return String(payload.meta.seed);
    const byName = agents.find(
      (node) =>
        valueAt(node, ["name", "label"], "").toLowerCase() === nextSeed.toLowerCase() || String(node.id) === nextSeed
    );
    return byName ? String(byName.id) : null;
  };

  const loadGraph = async (nextSeed = seed) => {
    setError(null);
    try {
      const payload = await apiRequest<GraphPayload>("/api/graph", {
        query: {
          agentId: nextSeed || undefined,
          depth,
          limit: nextSeed ? 80 : 50
        }
      });
      const agentId = nextSeed ? resolveFocusedAgent(payload, nextSeed) : null;
      await loadAnatomy(agentId);
      const nextParams = new URLSearchParams();
      if (agentId) nextParams.set("agentId", agentId);
      else if (nextSeed) nextParams.set("seed", nextSeed);
      setSearchParams(nextParams, { replace: true });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to load relationship graph.");
      setAnatomy(null);
      setFocusedAgent(null);
    }
  };

  useEffect(() => {
    if (searchParams.get("graph") === "1") {
      const id = searchParams.get("agentId") || searchParams.get("seed") || "";
      navigate(id ? `/neighborhood?agentId=${encodeURIComponent(id)}` : "/neighborhood", { replace: true });
      return;
    }
    void loadSeeds();
    void loadGraph(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void loadGraph(seed);
  };

  return (
    <div className="page relationships-page">
      {!focusedAgentId ? (
        <header className="page-header">
          <div>
            <p className="eyebrow">Relationships</p>
            <h1>Relationship Explorer</h1>
            <p className="page-description">
              Pick an agent to open its anatomy map — users, channels, actions, data, and inherent risk around the
              agent + LLM.
            </p>
          </div>
        </header>
      ) : null}

      <GraphSeedBar
        idPrefix="relationship"
        seed={seed}
        depth={depth}
        seeds={seeds}
        submitLabel="Open anatomy"
        clearLabel="Clear"
        showChips={!focusedAgentId}
        onSeedChange={setSeed}
        onDepthChange={setDepth}
        onSubmit={submit}
        onClear={() => {
          setSeed("");
          void loadGraph("");
        }}
        onPickSeed={(option) => {
          setSeed(option.id);
          void loadGraph(option.id);
        }}
        onSearchSeeds={(q) => void loadSeeds(q)}
        extraActions={
          <>
            <Link
              className="button ghost"
              to={
                focusedAgentId
                  ? `/neighborhood?agentId=${encodeURIComponent(focusedAgentId)}`
                  : seed
                    ? `/neighborhood?agentId=${encodeURIComponent(seed)}`
                    : "/neighborhood"
              }
            >
              Neighborhood graph
            </Link>
            <Link
              className="button ghost"
              to={
                focusedAgentId
                  ? `/topology?agentId=${encodeURIComponent(focusedAgentId)}`
                  : seed
                    ? `/topology?agentId=${encodeURIComponent(seed)}`
                    : "/topology"
              }
            >
              Full topology map
            </Link>
          </>
        }
      />

      {error ? <div className="error-state">{error}</div> : null}

      <AgentAnatomyPanel
        anatomy={anatomy}
        loading={anatomyLoading}
        error={anatomyError}
        onClear={
          focusedAgentId
            ? () => {
                setSeed("");
                void loadGraph("");
              }
            : undefined
        }
      />

      {focusedAgent ? (
        <div style={{ marginTop: 16 }}>
          <AgentExecutionTopology
            agent={focusedAgent as Record<string, unknown>}
            title="Execution path & tool relationships"
            compact
          />
        </div>
      ) : null}

    </div>
  );
}
