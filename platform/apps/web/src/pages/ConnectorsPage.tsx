import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiRequest, compactDate, listFromPayload, valueAt } from "../lib/api";

type ProviderKey = "azure" | "aws" | "gcp";

type ProviderSchema = {
  config: string[];
  secrets: string[];
  labels: Record<string, string>;
};

const EMPTY_FORM = {
  name: "",
  provider: "azure" as ProviderKey,
  environment: "production",
  status: "active",
  tenantId: "",
  subscriptionId: "",
  clientId: "",
  clientSecret: "",
  accountId: "",
  region: "us-east-1",
  accessKeyId: "",
  secretAccessKey: "",
  projectId: "",
  clientEmail: "",
  privateKey: ""
};

export function ConnectorsPage() {
  const [connectors, setConnectors] = useState<Record<string, unknown>[]>([]);
  const [schema, setSchema] = useState<Record<string, ProviderSchema>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editingId, setEditingId] = useState<string | null>(null);

  const providerSchema = schema[form.provider];

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [listPayload, schemaPayload] = await Promise.all([
        apiRequest<unknown>("/api/connectors"),
        apiRequest<{ providers?: Record<string, ProviderSchema> }>("/api/connectors/schema")
      ]);
      setConnectors(listFromPayload<Record<string, unknown>>(listPayload, ["connectors", "items"]));
      setSchema(schemaPayload.providers || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load connectors.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const fields = useMemo(() => {
    if (!providerSchema) return { config: [] as string[], secrets: [] as string[] };
    return providerSchema;
  }, [providerSchema]);

  const onChange = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const resetForm = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setMessage(null);
  };

  const startEdit = (connector: Record<string, unknown>) => {
    const config = (connector.config as Record<string, string>) || {};
    setEditingId(String(connector.id));
    setForm({
      ...EMPTY_FORM,
      name: String(connector.name || ""),
      provider: String(connector.provider || "azure") as ProviderKey,
      environment: String(connector.environment || "production"),
      status: String(connector.status || "active"),
      tenantId: config.tenantId || "",
      subscriptionId: config.subscriptionId || "",
      clientId: config.clientId || "",
      accountId: config.accountId || "",
      region: config.region || "us-east-1",
      accessKeyId: config.accessKeyId || "",
      projectId: config.projectId || "",
      clientEmail: config.clientEmail || "",
      clientSecret: "",
      secretAccessKey: "",
      privateKey: ""
    });
    setMessage("Leave secret fields blank to keep existing secrets.");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    const config: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    for (const key of fields.config) {
      const value = (form as Record<string, string>)[key];
      if (value) config[key] = value;
    }
    for (const key of fields.secrets) {
      const value = (form as Record<string, string>)[key];
      if (value) secrets[key] = value;
    }

    const body = {
      name: form.name,
      provider: form.provider,
      environment: form.environment,
      status: form.status,
      config,
      secrets
    };

    try {
      if (editingId) {
        await apiRequest(`/api/connectors/${encodeURIComponent(editingId)}`, {
          method: "PUT",
          body: JSON.stringify(body)
        });
        setMessage("Connector updated.");
      } else {
        await apiRequest("/api/connectors", {
          method: "POST",
          body: JSON.stringify(body)
        });
        setMessage("Connector saved. Secrets are encrypted at rest.");
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save connector.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this connector? Discovery will stop using these credentials.")) {
      return;
    }
    setError(null);
    try {
      await apiRequest(`/api/connectors/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (editingId === id) resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete connector.");
    }
  };

  const test = async (id: string) => {
    setError(null);
    setMessage(null);
    try {
      const result = await apiRequest<{ ok?: boolean; message?: string }>(
        `/api/connectors/${encodeURIComponent(id)}/test`,
        { method: "POST" }
      );
      setMessage(result.message || (result.ok ? "Connector test passed." : "Connector test failed."));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connector test failed.");
    }
  };

  const scanNow = async () => {
    setError(null);
    setMessage(null);
    try {
      await apiRequest("/api/discovery/jobs", {
        method: "POST",
        body: JSON.stringify({ collectors: ["cloud_stub"] })
      });
      setMessage(
        "Cloud discovery started. Open Discovery Dashboard or Inventory in ~10s to see Azure scan results (look for “Azure scan — …” and AI resources)."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start cloud discovery.");
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Connectors</h1>
          <p className="page-description">
            Add cloud and EDR environment credentials (Azure, AWS, GCP, and later CrowdStrike/Defender). Secrets are encrypted and never shown again.
            After saving Azure, click <strong>Test</strong> then <strong>Scan cloud now</strong> to discover resources. AgentRadar is agentless — endpoint coverage comes from EDR integrations, not a local client.
          </p>
        </div>
        <button className="button primary" type="button" onClick={() => void scanNow()}>
          Scan cloud now
        </button>
      </header>

      {error ? <div className="error-state">{error}</div> : null}
      {message ? <div className="status-pill" style={{ marginBottom: 16 }}>{message}</div> : null}

      <div className="split-layout">
        <section className="panel">
          <h2>{editingId ? "Edit connector" : "Add cloud environment"}</h2>
          <form className="connector-form" onSubmit={submit}>
            <label>
              Display name
              <input
                className="input"
                required
                value={form.name}
                onChange={(e) => onChange("name", e.target.value)}
                placeholder="Prod Azure subscription"
              />
            </label>

            <div className="form-row">
              <label>
                Provider
                <select
                  className="input"
                  value={form.provider}
                  disabled={Boolean(editingId)}
                  onChange={(e) => onChange("provider", e.target.value)}
                >
                  <option value="azure">Microsoft Azure</option>
                  <option value="aws">Amazon Web Services</option>
                  <option value="gcp">Google Cloud</option>
                </select>
              </label>
              <label>
                Environment
                <select
                  className="input"
                  value={form.environment}
                  onChange={(e) => onChange("environment", e.target.value)}
                >
                  <option value="production">Production</option>
                  <option value="staging">Staging</option>
                  <option value="development">Development</option>
                  <option value="sandbox">Sandbox</option>
                </select>
              </label>
            </div>

            <label>
              Status
              <select className="input" value={form.status} onChange={(e) => onChange("status", e.target.value)}>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>

            <h3 className="form-section-title">Connection details</h3>
            {fields.config.map((key) => (
              <label key={key}>
                {providerSchema?.labels?.[key] || key}
                <input
                  className="input"
                  value={(form as Record<string, string>)[key] || ""}
                  onChange={(e) => onChange(key, e.target.value)}
                  placeholder={providerSchema?.labels?.[key] || key}
                  autoComplete="off"
                />
              </label>
            ))}

            <h3 className="form-section-title">Secrets</h3>
            {fields.secrets.map((key) => (
              <label key={key}>
                {providerSchema?.labels?.[key] || key}
                <textarea
                  className="input"
                  rows={key === "privateKey" ? 5 : 2}
                  value={(form as Record<string, string>)[key] || ""}
                  onChange={(e) => onChange(key, e.target.value)}
                  placeholder={editingId ? "Leave blank to keep existing secret" : providerSchema?.labels?.[key]}
                  autoComplete="new-password"
                />
              </label>
            ))}

            <div className="toolbar" style={{ justifyContent: "flex-start", gap: 10, marginTop: 8 }}>
              <button className="button primary" type="submit" disabled={saving}>
                {saving ? "Saving..." : editingId ? "Update connector" : "Save connector"}
              </button>
              {editingId ? (
                <button className="button ghost" type="button" onClick={resetForm}>
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section className="panel">
          <h2>Configured environments</h2>
          {loading ? (
            <div className="loading-state">Loading connectors...</div>
          ) : connectors.length === 0 ? (
            <div className="empty-state">
              No cloud connectors yet. Add Azure, AWS, or GCP credentials to start environment discovery.
            </div>
          ) : (
            <div className="connector-list">
              {connectors.map((connector) => (
                <article className="connector-card" key={String(connector.id)}>
                  <div className="connector-card-head">
                    <div>
                      <strong>{valueAt(connector, ["name"])}</strong>
                      <div className="muted">
                        {String(connector.provider).toUpperCase()} · {valueAt(connector, ["environment"])}
                      </div>
                    </div>
                    <span className={`status-pill ${connector.status === "active" ? "" : "warn"}`}>
                      {valueAt(connector, ["status"])}
                    </span>
                  </div>
                  <div className="muted mono" style={{ fontSize: 12, marginTop: 8 }}>
                    Secrets: {(connector.secretFields as string[] | undefined)?.join(", ") || "configured"}
                    {connector.lastTestedAt
                      ? ` · Last tested ${compactDate(connector.lastTestedAt)}`
                      : " · Not tested"}
                  </div>
                  {connector.lastError ? (
                    <div className="error-state" style={{ marginTop: 8 }}>
                      {String(connector.lastError)}
                    </div>
                  ) : null}
                  <div className="toolbar" style={{ justifyContent: "flex-start", gap: 8, marginTop: 12 }}>
                    <button className="button" type="button" onClick={() => startEdit(connector)}>
                      Edit
                    </button>
                    <button className="button" type="button" onClick={() => void test(String(connector.id))}>
                      Test
                    </button>
                    <button className="button ghost" type="button" onClick={() => void remove(String(connector.id))}>
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
