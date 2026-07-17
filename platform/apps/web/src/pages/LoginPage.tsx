import { FormEvent, useEffect, useState } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { API_BASE_URL, apiRequest, setAuthToken } from "../lib/api";
import { useAuth } from "../lib/auth";
import { getPreferredTheme, toggleTheme, type ThemeMode } from "../lib/theme";

const isProdBuild = import.meta.env.PROD;

type SsoProvider = {
  id: string;
  key: string;
  preset?: string;
  name: string;
  protocol?: string;
  source?: string;
};

export function LoginPage() {
  const { isAuthenticated, login, loading, error } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(() => getPreferredTheme());
  const [providers, setProviders] = useState<SsoProvider[]>([]);
  const [ssoBusy, setSsoBusy] = useState(false);

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "/executive";

  useEffect(() => {
    apiRequest<{ providers?: SsoProvider[] }>("/api/auth/sso/status")
      .then((payload) => {
        const list = Array.isArray(payload.providers) ? payload.providers : [];
        // Backward compat: older API returned string[]
        setProviders(
          list.map((item) =>
            typeof item === "string"
              ? { id: item, key: item, name: item === "entra" ? "Microsoft Entra ID" : item }
              : item
          )
        );
      })
      .catch(() => setProviders([]));
  }, []);

  // Complete OIDC redirect: /login?code=...&state=...
  useEffect(() => {
    const code = searchParams.get("code");
    if (!code) return;
    let cancelled = false;
    setSsoBusy(true);
    const providerId = sessionStorage.getItem("ar_oidc_provider") || undefined;
    apiRequest<{ token?: string }>("/api/auth/sso/callback", {
      method: "POST",
      body: JSON.stringify({
        code,
        state: searchParams.get("state"),
        nonce: sessionStorage.getItem("ar_oidc_nonce"),
        providerId
      })
    })
      .then((payload) => {
        if (cancelled) return;
        if (!payload.token) throw new Error("SSO response missing token");
        sessionStorage.removeItem("ar_oidc_provider");
        sessionStorage.removeItem("ar_oidc_state");
        sessionStorage.removeItem("ar_oidc_nonce");
        setAuthToken(payload.token);
        window.location.replace(from);
      })
      .catch(async (err) => {
        // Fallback for env-only Entra deployments still using legacy callback
        if (!providerId || providerId === "env-entra" || providerId === "entra") {
          try {
            const legacy = await apiRequest<{ token?: string }>("/api/auth/sso/entra/callback", {
              method: "POST",
              body: JSON.stringify({
                code,
                state: searchParams.get("state"),
                nonce: sessionStorage.getItem("ar_oidc_nonce")
              })
            });
            if (cancelled) return;
            if (!legacy.token) throw new Error("SSO response missing token");
            setAuthToken(legacy.token);
            window.location.replace(from);
            return;
          } catch {
            /* use original error */
          }
        }
        if (!cancelled) {
          setSubmitError(err instanceof Error ? err.message : "SSO sign-in failed");
          setSsoBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [from, searchParams]);

  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitError(null);

    try {
      await login(email, password);
    } catch (loginError) {
      setSubmitError(loginError instanceof Error ? loginError.message : "Unable to sign in.");
    }
  };

  const startSso = async (provider: SsoProvider) => {
    setSubmitError(null);
    setSsoBusy(true);
    try {
      const payload = await apiRequest<{ authorizeUrl: string; state: string; nonce: string }>(
        `/api/auth/sso/${encodeURIComponent(provider.id)}/start`
      );
      sessionStorage.setItem("ar_oidc_provider", provider.id);
      sessionStorage.setItem("ar_oidc_state", payload.state);
      sessionStorage.setItem("ar_oidc_nonce", payload.nonce);
      window.location.href = payload.authorizeUrl;
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Unable to start SSO");
      setSsoBusy(false);
    }
  };

  return (
    <div className="login-page">
      <button
        className="theme-toggle login-theme-toggle"
        type="button"
        aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
        onClick={() => setTheme(toggleTheme(theme))}
      >
        {theme === "light" ? "Dark mode" : "Light mode"}
      </button>
      <section className="login-hero">
        <div className="brand-lockup" style={{ borderBottom: 0 }}>
          <div className="brand-mark">AR</div>
          <div>
            <div className="brand-title">AgentRadar</div>
            <div className="brand-subtitle">Enterprise AI agent discovery</div>
          </div>
        </div>

        <div>
          <p className="eyebrow">Discovery & Visibility</p>
          <h1>Know every agent, model, edge, and runtime in motion.</h1>
          <p className="page-description">
            A high-trust command center for inventory, topology, usage analytics, discovery events,
            and enterprise search across the AI estate.
          </p>
        </div>

        <div className="three-grid">
          <div className="panel">
            <h3>Inventory</h3>
            <p className="muted">Canonical agents with owners, frameworks, confidence, and recency.</p>
          </div>
          <div className="panel">
            <h3>Topology</h3>
            <p className="muted">Interactive relationship graph with live updates from the API stream.</p>
          </div>
          <div className="panel">
            <h3>Usage</h3>
            <p className="muted">Models, frameworks, cloud, IDE, and timeline analytics for teams.</p>
          </div>
        </div>
      </section>

      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <p className="eyebrow">Secure access</p>
          <h2>Sign in to AgentRadar</h2>
          {!isProdBuild ? (
            <p className="muted">
              API base: <span className="mono">{API_BASE_URL}</span>
            </p>
          ) : null}

          {providers.length ? (
            <div className="connector-list" style={{ marginTop: 18 }}>
              {providers.map((provider) => (
                <button
                  key={provider.id}
                  className="button"
                  type="button"
                  disabled={ssoBusy || loading}
                  style={{ width: "100%" }}
                  onClick={() => void startSso(provider)}
                >
                  {ssoBusy ? "Redirecting…" : `Sign in with ${provider.name}`}
                </button>
              ))}
            </div>
          ) : null}

          {providers.length ? (
            <p className="muted" style={{ marginTop: 16, textAlign: "center" }}>
              or use local admin
            </p>
          ) : null}

          <div className="field" style={{ marginTop: 18 }}>
            <label htmlFor="email">Email</label>
            <input
              autoComplete="email"
              className="input"
              id="email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="password">Password</label>
            <input
              autoComplete="current-password"
              className="input"
              id="password"
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {(submitError || error) && (
            <div className="error-state" style={{ minHeight: 72, marginTop: 16 }}>
              {submitError ?? error}
            </div>
          )}

          <button className="button primary" disabled={loading || ssoBusy} style={{ width: "100%", marginTop: 18 }} type="submit">
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </div>
  );
}
