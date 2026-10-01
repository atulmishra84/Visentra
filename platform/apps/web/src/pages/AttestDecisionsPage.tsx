import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "../lib/api";

type AttestIntegration = {
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

const DEFAULT_URL = "http://127.0.0.1:3000/api/decisions";

export function AttestDecisionsPage() {
  const [integration, setIntegration] = useState<AttestIntegration | null>(null);
  const [name, setName] = useState("Attest decisions");
  const [enabled, setEnabled] = useState(false);
  const [autoPush, setAutoPush] = useState(true);
  const [webhookUrl, setWebhookUrl] = useState(DEFAULT_URL);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ agent_count?: number; decision_count?: number } | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiRequest<{ integration?: AttestIntegration | null }>("/api/integrations/attest");
      const row = payload.integration || null;
      setIntegration(row);
      setName(row?.name || "Attest decisions");
      setEnabled(Boolean(row?.enabled));
      setAutoPush(row?.autoPush !== false);
      setWebhookUrl(row?.webhookUrl || DEFAULT_URL);
      setApiKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Attest settings");
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
      const body: Record<string, unknown> = { name, enabled, autoPush, webhookUrl };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      const payload = await apiRequest<{ integration: AttestIntegration }>("/api/integrations/attest", {
        method: "PUT",
        body: JSON.stringify(body)
      });
      setIntegration(payload.integration);
      setApiKey("");
      setMessage("Attest integration saved.");
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
      const result = await apiRequest<{ ok?: boolean; message?: string; status?: number }>("/api/integrations/attest/test", {
        method: "POST",
        body: "{}"
      });
      if (result.ok) setMessage(result.message || "Attest accepted the API key.");
      else setError(result.message || `Attest responded HTTP ${result.status}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test failed");
    } finally {
      setBusy(false);
    }
  };

  const previewFeed = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await apiRequest<{ agent_count?: number; decision_count?: number }>("/api/integrations/attest/feed");
      setPreview(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
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
        decisionCount?: number;
        message?: string | null;
      }>("/api/integrations/attest/sync", { method: "POST", body: "{}" });
      const summary =
        result.message || `Registered ${result.agentCount ?? 0} agents and posted ${result.decisionCount ?? 0} decisions.`;
      if (result.ok) setMessage(summary);
      else setError(summary);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="loading-state">Loading Attest integration…</div>;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Attest decisions</h1>
          <p className="page-description">
            Send discovered agents and the runtime actions already stored by discovery to Attest. Each action is
            posted to the decisions endpoint. Prompts and raw payloads are not included.
          </p>
        </div>
      </header>

      <section className="panel" style={{ maxWidth: 720 }}>
        <form className="stack" onSubmit={(event) => void save(event)}>
          <label>
            Name
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label>
            Decisions URL
            <input className="input" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} />
            <span className="muted" style={{ display: "block", marginTop: 6, fontSize: 13 }}>
              Local Attest listens at {DEFAULT_URL}. The API key is sent as X-API-Key.
            </span>
          </label>
          <label>
            Attest API key {integration?.hasApiKey ? `(saved: ${integration.apiKeyMasked})` : ""}
            <input
              className="input"
              type="password"
              autoComplete="off"
              placeholder={integration?.hasApiKey ? "Leave blank to keep the saved key" : "Required"}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            Enable Attest integration
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={autoPush} onChange={(event) => setAutoPush(event.target.checked)} />
            Send after each discovery job
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
              Send now
            </button>
          </div>
        </form>
        {message ? <p className="ok">{message}</p> : null}
        {error ? <p className="error-state">{error}</p> : null}
        <div className="muted" style={{ marginTop: 18 }}>
          <div>Last send: {integration?.lastSyncAt ? new Date(integration.lastSyncAt).toLocaleString() : "never"}</div>
          <div>Status: {integration?.lastSyncStatus || "—"}</div>
          <div>Decisions last posted: {integration?.lastSyncCount ?? "—"}</div>
          {integration?.lastSyncError ? <div>Error: {integration.lastSyncError}</div> : null}
          {preview ? (
            <div>
              Preview: {preview.agent_count ?? 0} agents, {preview.decision_count ?? 0} runtime actions
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel" style={{ marginTop: 16, maxWidth: 720 }}>
        <h3>What is sent</h3>
        <ul className="muted">
          <li>Discovered agents are registered on the same Attest host so a decision is not rejected as unknown.</li>
          <li>Each stored runtime action is posted to the decisions URL with agent id, operation, and resource.</li>
          <li>A tool name is included only when discovery stored one. Unread calls are not invented.</li>
        </ul>
      </section>
    </div>
  );
}
