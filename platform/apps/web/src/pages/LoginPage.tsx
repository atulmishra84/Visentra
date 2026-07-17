import { FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
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
  const [showLocal, setShowLocal] = useState(false);

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "/executive";

  useEffect(() => {
    document.documentElement.removeAttribute("data-landing");
    document.documentElement.setAttribute("data-login", "true");
    return () => document.documentElement.removeAttribute("data-login");
  }, []);

  useEffect(() => {
    apiRequest<{ providers?: SsoProvider[] }>("/api/auth/sso/status")
      .then((payload) => {
        const list = Array.isArray(payload.providers) ? payload.providers : [];
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

  const hasSso = providers.length > 0;
  const localVisible = !hasSso || showLocal;

  return (
    <div className="login-page">
      <div className="login-atmosphere" aria-hidden="true">
        <div className="login-orbit login-orbit-a" />
        <div className="login-orbit login-orbit-b" />
        <div className="login-mesh" />
      </div>

      <button
        className="theme-toggle login-theme-toggle"
        type="button"
        aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
        onClick={() => setTheme(toggleTheme(theme))}
      >
        {theme === "light" ? "Dark" : "Light"}
      </button>

      <section className="login-hero">
        <div className="login-hero-visual" aria-hidden="true">
          <img
            className="login-hero-image"
            src="/images/login-mesh-hero.jpg"
            alt=""
            width={1920}
            height={1080}
            decoding="async"
            fetchPriority="high"
          />
          <div className="login-hero-scrim" />
        </div>

        <div className="login-hero-content">
          <Link className="login-brand" to="/" aria-label="Visentra home">
            <div className="brand-mark login-brand-mark">VE</div>
            <div className="login-brand-name">Visentra</div>
          </Link>

          <div className="login-hero-copy">
            <h1>AI agent discovery for the enterprise.</h1>
            <p>
              See every agent, model, and runtime across cloud, endpoints, and SaaS — without deploying another
              agent.
            </p>
          </div>

          <p className="login-hero-foot muted">Discovery &amp; visibility · Not enforcement</p>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-form-shell">
          <header className="login-form-header">
            <h2>Sign in</h2>
            <p className="muted">Access your Visentra workspace</p>
          </header>

          {!isProdBuild ? (
            <p className="login-dev-hint muted">
              API <span className="mono">{API_BASE_URL}</span>
            </p>
          ) : null}

          {hasSso ? (
            <div className="login-sso">
              {providers.map((provider) => (
                <button
                  key={provider.id}
                  className="button login-sso-button"
                  type="button"
                  disabled={ssoBusy || loading}
                  onClick={() => void startSso(provider)}
                >
                  {ssoBusy ? "Redirecting…" : `Continue with ${provider.name}`}
                </button>
              ))}
            </div>
          ) : null}

          {hasSso ? (
            <div className="login-divider" role="separator">
              <span>or</span>
            </div>
          ) : null}

          {hasSso && !showLocal ? (
            <button
              className="button ghost login-local-toggle"
              type="button"
              disabled={ssoBusy || loading}
              onClick={() => setShowLocal(true)}
            >
              Sign in with email
            </button>
          ) : null}

          {localVisible ? (
            <form className="login-form" onSubmit={submit}>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  autoComplete="email"
                  className="input"
                  id="email"
                  type="email"
                  required
                  autoFocus={!hasSso}
                  placeholder="you@company.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>

              <div className="field">
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
                <div className="login-error" role="alert">
                  {submitError ?? error}
                </div>
              )}

              <button className="button primary login-submit" disabled={loading || ssoBusy} type="submit">
                {loading ? "Signing in…" : "Sign in"}
              </button>
            </form>
          ) : null}

          {!localVisible && (submitError || error) ? (
            <div className="login-error" role="alert">
              {submitError ?? error}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
