import { FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { VisentraLogo } from "../components/VisentraLogo";
import { API_BASE_URL, apiRequest, setAuthToken } from "../lib/api";
import { useAuth } from "../lib/auth";
import { getPreferredTheme, toggleTheme, type ThemeMode } from "../lib/theme";

const isProdBuild = import.meta.env.PROD;

export function LoginPage() {
  const { isAuthenticated, login, loading, error } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(() => getPreferredTheme());
  const [entraEnabled, setEntraEnabled] = useState(false);
  const [ssoBusy, setSsoBusy] = useState(false);

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "/executive";

  useEffect(() => {
    apiRequest<{ entraEnabled?: boolean }>("/api/auth/sso/status")
      .then((payload) => setEntraEnabled(Boolean(payload.entraEnabled)))
      .catch(() => setEntraEnabled(false));
  }, []);

  useEffect(() => {
    const code = searchParams.get("code");
    if (!code) return;
    let cancelled = false;
    setSsoBusy(true);
    apiRequest<{ token?: string }>("/api/auth/sso/entra/callback", {
      method: "POST",
      body: JSON.stringify({
        code,
        state: searchParams.get("state"),
        nonce: sessionStorage.getItem("ar_oidc_nonce")
      })
    })
      .then((payload) => {
        if (cancelled) return;
        if (!payload.token) throw new Error("SSO response missing token");
        setAuthToken(payload.token);
        window.location.replace(from);
      })
      .catch((err) => {
        if (!cancelled) {
          setSubmitError(err instanceof Error ? err.message : "Entra SSO failed");
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

  const startEntra = async () => {
    setSubmitError(null);
    setSsoBusy(true);
    try {
      const payload = await apiRequest<{ authorizeUrl: string; state: string; nonce: string }>(
        "/api/auth/sso/entra/start"
      );
      sessionStorage.setItem("ar_oidc_state", payload.state);
      sessionStorage.setItem("ar_oidc_nonce", payload.nonce);
      window.location.href = payload.authorizeUrl;
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Unable to start Entra SSO");
      setSsoBusy(false);
    }
  };

  return (
    <div className="credentials-page">
      <button
        className="theme-toggle login-theme-toggle"
        type="button"
        aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
        onClick={() => setTheme(toggleTheme(theme))}
      >
        {theme === "light" ? "Dark mode" : "Light mode"}
      </button>

      <div className="credentials-shell">
        <Link className="credentials-back" to="/">
          ← Back to Visentra
        </Link>

        <form className="credentials-card" onSubmit={submit}>
          <div className="credentials-brand">
            <VisentraLogo size={48} />
            <div>
              <div className="brand-title">Visentra</div>
              <div className="brand-subtitle">Sign in with your credentials</div>
            </div>
          </div>

          <h1 className="credentials-title">Welcome back</h1>
          <p className="muted credentials-copy">Enter your email and password to open the command center.</p>

          {!isProdBuild ? (
            <p className="muted" style={{ marginTop: 8 }}>
              API base: <span className="mono">{API_BASE_URL}</span>
            </p>
          ) : null}

          {entraEnabled ? (
            <button
              className="button"
              type="button"
              disabled={ssoBusy || loading}
              style={{ width: "100%", marginTop: 18 }}
              onClick={startEntra}
            >
              {ssoBusy ? "Redirecting…" : "Sign in with Microsoft Entra ID"}
            </button>
          ) : null}

          {entraEnabled ? (
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

          <button
            className="button primary"
            disabled={loading || ssoBusy}
            style={{ width: "100%", marginTop: 18 }}
            type="submit"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
