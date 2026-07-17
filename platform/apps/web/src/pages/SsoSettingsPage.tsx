import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiRequest, listFromPayload } from "../lib/api";

type SsoPreset = {
  key: string;
  label: string;
  protocol: string;
  fields: string[];
  defaultScopes?: string;
};

type SsoProvider = {
  id: string;
  key: string;
  preset: string;
  name: string;
  protocol: string;
  enabled: boolean;
  source?: string;
  clientId?: string;
  hasClientSecret?: boolean;
  redirectUri?: string;
  config?: Record<string, unknown>;
  claimMap?: Record<string, unknown>;
  allowedDomains?: string[];
};

const EMPTY = {
  name: "",
  key: "",
  preset: "generic_oidc",
  protocol: "oidc",
  enabled: true,
  clientId: "",
  clientSecret: "",
  redirectUri: "",
  scopes: "openid profile email",
  issuer: "",
  discoveryUrl: "",
  authorizeUrl: "",
  tokenUrl: "",
  tenantId: "",
  domain: "",
  entityId: "",
  ssoUrl: "",
  metadataUrl: "",
  certificate: "",
  allowedDomains: "",
  defaultRole: "viewer"
};

const FIELD_LABELS: Record<string, string> = {
  tenantId: "Entra tenant ID",
  domain: "IdP domain (e.g. acme.okta.com)",
  issuer: "Issuer URL",
  discoveryUrl: "Discovery URL (.well-known/openid-configuration)",
  authorizeUrl: "Authorize URL (optional if discovery set)",
  tokenUrl: "Token URL (optional if discovery set)",
  entityId: "SAML Entity ID",
  ssoUrl: "SAML SSO URL",
  metadataUrl: "SAML metadata URL",
  certificate: "IdP signing certificate (PEM)"
};

export function SsoSettingsPage() {
  const [providers, setProviders] = useState<SsoProvider[]>([]);
  const [presets, setPresets] = useState<SsoPreset[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ ...EMPTY });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedPreset = useMemo(
    () => presets.find((p) => p.key === form.preset) || null,
    [form.preset, presets]
  );

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiRequest<{
        providers?: SsoProvider[];
        schema?: { presets?: SsoPreset[]; notes?: Record<string, string> };
      }>("/api/settings/sso");
      setProviders(listFromPayload<SsoProvider>(payload, ["providers"]));
      setPresets(payload.schema?.presets || []);
      setNotes(payload.schema?.notes || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load SSO settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const setField = (key: keyof typeof EMPTY, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const resetForm = () => {
    setEditingId(null);
    setForm({ ...EMPTY });
  };

  const editProvider = (provider: SsoProvider) => {
    const cfg = provider.config || {};
    setEditingId(provider.id);
    setForm({
      ...EMPTY,
      name: provider.name || "",
      key: provider.key || "",
      preset: provider.preset || "generic_oidc",
      protocol: provider.protocol || "oidc",
      enabled: provider.enabled !== false,
      clientId: provider.clientId || "",
      clientSecret: "",
      redirectUri: provider.redirectUri || String(cfg.redirectUri || ""),
      scopes: String(cfg.scopes || "openid profile email"),
      issuer: String(cfg.issuer || ""),
      discoveryUrl: String(cfg.discoveryUrl || ""),
      authorizeUrl: String(cfg.authorizeUrl || ""),
      tokenUrl: String(cfg.tokenUrl || ""),
      tenantId: String(cfg.tenantId || ""),
      domain: String(cfg.domain || ""),
      entityId: String(cfg.entityId || ""),
      ssoUrl: String(cfg.ssoUrl || ""),
      metadataUrl: String(cfg.metadataUrl || ""),
      certificate: String(cfg.certificate || ""),
      allowedDomains: (provider.allowedDomains || []).join(", "),
      defaultRole: String(provider.claimMap?.defaultRole || "viewer")
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const config: Record<string, string> = {};
      for (const field of selectedPreset?.fields || []) {
        const value = String((form as Record<string, string | boolean>)[field] || "").trim();
        if (value) config[field] = value;
      }
      if (form.redirectUri.trim()) config.redirectUri = form.redirectUri.trim();
      if (form.scopes.trim()) config.scopes = form.scopes.trim();

      const body = {
        name: form.name.trim(),
        key: form.key.trim() || undefined,
        preset: form.preset,
        protocol: selectedPreset?.protocol || form.protocol,
        enabled: form.enabled,
        clientId: form.clientId.trim(),
        clientSecret: form.clientSecret.trim() || undefined,
        redirectUri: form.redirectUri.trim() || undefined,
        scopes: form.scopes.trim() || undefined,
        config,
        allowedDomains: form.allowedDomains
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean),
        claimMap: { defaultRole: form.defaultRole || "viewer" }
      };

      if (editingId) {
        await apiRequest(`/api/settings/sso/${editingId}`, { method: "PUT", body: JSON.stringify(body) });
        setMessage("SSO provider updated.");
      } else {
        await apiRequest("/api/settings/sso", { method: "POST", body: JSON.stringify(body) });
        setMessage("SSO provider created.");
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save SSO provider");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setError(null);
    setMessage(null);
    try {
      await apiRequest(`/api/settings/sso/${id}`, { method: "DELETE" });
      setMessage("SSO provider removed.");
      if (editingId === id) resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete SSO provider");
    }
  };

  const test = async (id: string) => {
    setError(null);
    setMessage(null);
    try {
      const result = await apiRequest<{ message?: string; issuer?: string }>(`/api/settings/sso/${id}/test`, {
        method: "POST",
        body: "{}"
      });
      setMessage(result.message || (result.issuer ? `Resolved issuer ${result.issuer}` : "SSO test passed."));
    } catch (err) {
      setError(err instanceof Error ? err.message : "SSO test failed");
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>IAM & SSO</h1>
          <p className="page-description">
            Connect any OpenID Connect identity provider — Entra, Okta, Auth0, Ping, Keycloak, Google Workspace,
            OneLogin, or a custom issuer. Local admin login remains available.
          </p>
        </div>
      </header>

      {error ? <div className="error-state">{error}</div> : null}
      {message ? <div className="status-pill">{message}</div> : null}

      <section className="split-layout">
        <form className="panel connector-form" onSubmit={submit}>
          <h2>{editingId ? "Edit identity provider" : "Add identity provider"}</h2>
          <p className="muted small">{notes.oidc}</p>

          <label>
            Preset
            <select
              className="select"
              value={form.preset}
              onChange={(e) => {
                const preset = presets.find((p) => p.key === e.target.value);
                setForm((prev) => ({
                  ...prev,
                  preset: e.target.value,
                  protocol: preset?.protocol || "oidc",
                  scopes: preset?.defaultScopes || prev.scopes,
                  name: prev.name || preset?.label || ""
                }));
              }}
            >
              {presets.map((preset) => (
                <option key={preset.key} value={preset.key}>
                  {preset.label} ({preset.protocol.toUpperCase()})
                </option>
              ))}
            </select>
          </label>

          <div className="form-row">
            <label>
              Display name
              <input className="input" required value={form.name} onChange={(e) => setField("name", e.target.value)} />
            </label>
            <label>
              Key
              <input
                className="input"
                placeholder="auto from preset"
                value={form.key}
                onChange={(e) => setField("key", e.target.value)}
              />
            </label>
          </div>

          {(selectedPreset?.protocol || form.protocol) === "oidc" ? (
            <>
              <div className="form-row">
                <label>
                  Client ID
                  <input
                    className="input"
                    required
                    value={form.clientId}
                    onChange={(e) => setField("clientId", e.target.value)}
                  />
                </label>
                <label>
                  Client secret
                  <input
                    className="input"
                    type="password"
                    placeholder={editingId ? "Leave blank to keep existing" : ""}
                    value={form.clientSecret}
                    onChange={(e) => setField("clientSecret", e.target.value)}
                  />
                </label>
              </div>
              <label>
                Redirect URI
                <input
                  className="input"
                  placeholder="Defaults to {web origin}/login"
                  value={form.redirectUri}
                  onChange={(e) => setField("redirectUri", e.target.value)}
                />
              </label>
              <label>
                Scopes
                <input className="input" value={form.scopes} onChange={(e) => setField("scopes", e.target.value)} />
              </label>
            </>
          ) : (
            <p className="hint">{notes.saml}</p>
          )}

          {(selectedPreset?.fields || []).map((field) => (
            <label key={field}>
              {FIELD_LABELS[field] || field}
              <input
                className="input"
                value={String((form as Record<string, string | boolean>)[field] || "")}
                onChange={(e) => setField(field as keyof typeof EMPTY, e.target.value)}
              />
            </label>
          ))}

          <div className="form-row">
            <label>
              Allowed email domains
              <input
                className="input"
                placeholder="acme.com, contoso.com (empty = any)"
                value={form.allowedDomains}
                onChange={(e) => setField("allowedDomains", e.target.value)}
              />
            </label>
            <label>
              Default role
              <select className="select" value={form.defaultRole} onChange={(e) => setField("defaultRole", e.target.value)}>
                <option value="viewer">viewer</option>
                <option value="operator">operator</option>
                <option value="platform_admin">platform_admin</option>
              </select>
            </label>
          </div>

          <label className="usage-controls">
            <span className="toggle">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setField("enabled", e.target.checked)}
              />
              Enabled on login page
            </span>
          </label>

          <div className="toolbar">
            <button className="button primary" disabled={saving} type="submit">
              {saving ? "Saving…" : editingId ? "Update provider" : "Add provider"}
            </button>
            {editingId ? (
              <button className="button ghost" type="button" onClick={resetForm}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>

        <section className="panel">
          <div className="panel-heading">
            <h2>Configured providers</h2>
            <span className="status-pill">{providers.length}</span>
          </div>
          {loading ? <div className="loading-state">Loading SSO providers…</div> : null}
          {!loading && providers.length === 0 ? (
            <p className="muted">
              No database providers yet. Env-based Entra still appears on login when{" "}
              <span className="mono">ENTRA_*</span> is set. Add Okta, Auth0, or a generic OIDC issuer here.
            </p>
          ) : null}
          <div className="connector-list">
            {providers.map((provider) => (
              <article className="connector-card" key={provider.id}>
                <div className="connector-card-head">
                  <div>
                    <strong>{provider.name}</strong>
                    <div className="muted small">
                      {provider.preset} · {provider.protocol.toUpperCase()} · {provider.key}
                      {provider.hasClientSecret ? " · secret set" : ""}
                    </div>
                  </div>
                  <span className={`status-pill ${provider.enabled ? "status-available" : "status-disabled"}`}>
                    {provider.enabled ? "enabled" : "disabled"}
                  </span>
                </div>
                <div className="toolbar" style={{ marginTop: 10 }}>
                  <button className="button ghost" type="button" onClick={() => editProvider(provider)}>
                    Edit
                  </button>
                  <button className="button ghost" type="button" onClick={() => void test(provider.id)}>
                    Test
                  </button>
                  <button className="button ghost" type="button" onClick={() => void remove(provider.id)}>
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </div>
  );
}
