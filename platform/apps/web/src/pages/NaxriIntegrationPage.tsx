import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "../lib/api";

type NaxriIntegration = {
  id: string;
  name: string;
  enabled: boolean;
  autoPush: boolean;
  webhookUrl?: string | null;
  hasApiKey?: boolean;
  apiKeyMasked?: string | null;
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null;
  lastSyncError?: string | null;
  lastSyncCount?: number | null;
};

export function NaxriIntegrationPage() {
  const [integration, setIntegration] = useState<NaxriIntegration | null>(null);
  const [name, setName] = useState("NAXRI ASPM");
  const [enabled, setEnabled] = useState(false);
  const [autoPush, setAutoPush] = useState(true);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedPreview, setFeedPreview] = useState<{ agent_count?: number; generated_at?: string } | null>(
    null
  );

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiRequest<{ integration?: NaxriIntegration | null }>("/api/integrations/naxri");
      const row = payload.integration || null;
      setIntegration(row);
      setName(row?.name || "NAXRI ASPM");
      setEnabled(Boolean(row?.enabled));
      setAutoPush(row?.autoPush !== false);
      setWebhookUrl(row?.webhookUrl || "");
      setApiKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load NAXRI settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name,
        enabled,
        autoPush,
        webhookUrl
      };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      const payload = await apiRequest<{ integration: NaxriIntegration }>("/api/integrations/naxri", {
        method: "PUT",
        body: JSON.stringify(body)
      });
      setIntegration(payload.integration);
      setApiKey("");
      setMessage("NAXRI integration saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await apiRequest<{ ok?: boolean; status?: number; body?: string }>(
        "/api/integrations/naxri/test",
        { method: "POST", body: "{}" }
      );
      setMessage(
        result.ok
          ? `Connection OK (HTTP ${result.status}).`
          : `Connection failed (HTTP ${result.status}): ${result.body || "no body"}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test failed");
    } finally {
      setBusy(false);
    }
  };

  const runSync = async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await apiRequest<{
        ok?: boolean;
        agentCount?: number;
        status?: number;
        feed?: { agent_count?: number; generated_at?: string };
      }>("/api/integrations/naxri/sync", { method: "POST", body: "{}" });
      setMessage(`Pushed ${result.agentCount ?? 0} agents to NAXRI (HTTP ${result.status}).`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  };

  const previewFeed = async () => {
    setBusy(true);
    setError(null);
    try {
      const feed = await apiRequest<{ agent_count?: number; generated_at?: string }>(
        "/api/integrations/naxri/feed"
      );
      setFeedPreview({ agent_count: feed.agent_count, generated_at: feed.generated_at });
      setMessage(`Feed preview ready: ${feed.agent_count ?? 0} agents.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Feed preview failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="loading-state">Loading NAXRI integration…</div>;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>NAXRI ASPM feed</h1>
          <p className="page-description">
            Send Visentra discovered agents to NAXRI for AI security posture management. Visentra remains the
            discovery source of truth; NAXRI consumes the feed for posture scoring and controls.
          </p>
        </div>
      </header>

      <section className="panel" style={{ maxWidth: 720 }}>
        <form className="stack" onSubmit={save}>
          <label>
            Name
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            NAXRI webhook URL
            <input
              className="input"
              placeholder="https://naxri.example.com/api/v1/visentra/agents"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
            />
          </label>
          <label>
            API key / bearer token {integration?.hasApiKey ? `(saved: ${integration.apiKeyMasked})` : ""}
            <input
              className="input"
              type="password"
              autoComplete="off"
              placeholder={integration?.hasApiKey ? "Leave blank to keep existing key" : "Optional"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Enable NAXRI integration
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={autoPush} onChange={(e) => setAutoPush(e.target.checked)} />
            Auto-push after each discovery job
          </label>

          <div className="button-row" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="button primary" type="submit" disabled={busy}>
              Save
            </button>
            <button className="button" type="button" disabled={busy} onClick={() => void runTest()}>
              Test connection
            </button>
            <button className="button" type="button" disabled={busy} onClick={() => void previewFeed()}>
              Preview feed
            </button>
            <button className="button" type="button" disabled={busy || !enabled} onClick={() => void runSync()}>
              Sync now
            </button>
          </div>
        </form>

        {message ? <p className="ok">{message}</p> : null}
        {error ? <p className="error-state">{error}</p> : null}

        <div className="muted" style={{ marginTop: 18 }}>
          <div>
            Last sync: {integration?.lastSyncAt ? new Date(integration.lastSyncAt).toLocaleString() : "never"}
          </div>
          <div>Status: {integration?.lastSyncStatus || "—"}</div>
          <div>Agents last pushed: {integration?.lastSyncCount ?? "—"}</div>
          {integration?.lastSyncError ? <div>Error: {integration.lastSyncError}</div> : null}
          {feedPreview ? (
            <div>
              Preview: {feedPreview.agent_count} agents @ {feedPreview.generated_at}
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel" style={{ marginTop: 16, maxWidth: 720 }}>
        <h3>How NAXRI consumes the feed</h3>
        <ul className="muted">
          <li>
            <strong>Push:</strong> Visentra POSTs an inventory snapshot to the webhook after discovery (when
            auto-push is on) or when you click Sync now.
          </li>
          <li>
            <strong>Pull:</strong> NAXRI can call <code>GET /api/integrations/naxri/feed</code> with a Visentra
            service JWT.
          </li>
          <li>
            Payload spec: <code>visentra.naxri.agent_feed/1.0</code> with agent id, fingerprint, model, tools,
            MCP connections, risk indicators, and evidence metadata.
          </li>
        </ul>
      </section>
    </div>
  );
}
