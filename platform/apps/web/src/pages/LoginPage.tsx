import { FormEvent, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { API_BASE_URL } from "../lib/api";
import { useAuth } from "../lib/auth";

export function LoginPage() {
  const { isAuthenticated, login, loading, error } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("admin@agentradar.local");
  const [password, setPassword] = useState("AgentRadar!dev");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "/executive";

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

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="brand-lockup" style={{ borderBottom: 0 }}>
          <div className="brand-mark">AR</div>
          <div>
            <div className="brand-title">AgentRadar</div>
            <div className="brand-subtitle">Enterprise AI agent discovery</div>
          </div>
        </div>

        <div>
          <p className="eyebrow">Discovery & Visibility MVP</p>
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
          <p className="muted">API base: <span className="mono">{API_BASE_URL}</span></p>

          <div className="hint">
            Default login hint: <span className="mono">admin@agentradar.local</span> /
            <span className="mono"> AgentRadar!dev</span>
          </div>

          <div className="field" style={{ marginTop: 18 }}>
            <label htmlFor="email">Email</label>
            <input
              autoComplete="email"
              className="input"
              id="email"
              type="email"
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
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {(submitError || error) && (
            <div className="error-state" style={{ minHeight: 72, marginTop: 16 }}>
              {submitError ?? error}
            </div>
          )}

          <button className="button primary" disabled={loading} style={{ width: "100%", marginTop: 18 }} type="submit">
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </div>
  );
}
