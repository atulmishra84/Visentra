import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { getPreferredTheme, toggleTheme, type ThemeMode } from "../lib/theme";

export function LandingPage() {
  const { isAuthenticated } = useAuth();
  const [theme, setTheme] = useState<ThemeMode>(() => getPreferredTheme());

  useEffect(() => {
    document.documentElement.setAttribute("data-landing", "true");
    return () => document.documentElement.removeAttribute("data-landing");
  }, []);

  return (
    <div className="lp">
      <div className="lp-atmosphere" aria-hidden="true" />

      <header className="lp-nav">
        <Link className="lp-nav-brand" to="/">
          <span className="brand-mark lp-mark">VE</span>
          <span className="lp-nav-name">Visentra</span>
        </Link>
        <div className="lp-nav-actions">
          <button
            className="theme-toggle"
            type="button"
            aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            onClick={() => setTheme(toggleTheme(theme))}
          >
            {theme === "light" ? "Dark" : "Light"}
          </button>
          {isAuthenticated ? (
            <Link className="button primary" to="/executive">
              Open platform
            </Link>
          ) : (
            <Link className="button primary" to="/login">
              Sign in
            </Link>
          )}
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-visual" aria-hidden="true">
          <img
            className="lp-hero-image"
            src="/images/login-mesh-hero.jpg"
            alt=""
            width={1920}
            height={1080}
            decoding="async"
            fetchPriority="high"
          />
          <div className="lp-hero-scrim" />
        </div>

        <div className="lp-hero-content">
          <p className="lp-brand-word">Visentra</p>
          <h1>See every AI agent in your enterprise.</h1>
          <p className="lp-hero-sub">
            Agentless discovery and visibility across cloud, endpoints, SaaS, and code — without deploying another
            agent.
          </p>
          <div className="lp-cta-row">
            {isAuthenticated ? (
              <Link className="button primary lp-cta" to="/executive">
                Open platform
              </Link>
            ) : (
              <Link className="button primary lp-cta" to="/login">
                Sign in to Visentra
              </Link>
            )}
            <a className="button ghost lp-cta" href="#how">
              How it works
            </a>
          </div>
        </div>
      </section>

      <section className="lp-section" id="discover">
        <div className="lp-section-inner">
          <p className="lp-kicker">Discover</p>
          <h2>Inventory the AI estate you already run.</h2>
          <p className="lp-section-copy">
            Connect cloud, EDR, identity, CI, and SaaS sources. Visentra classifies agents, models, owners, and
            evidence — so shadow AI stops being invisible.
          </p>
        </div>
      </section>

      <section className="lp-section lp-section-alt" id="visibility">
        <div className="lp-section-inner">
          <p className="lp-kicker">Visibility</p>
          <h2>Map relationships, not just rows.</h2>
          <p className="lp-section-copy">
            Global Agent Mesh and relationship anatomy show how agents connect to models, data, and channels —
            discovery and visibility only, never enforcement.
          </p>
        </div>
      </section>

      <section className="lp-section" id="how">
        <div className="lp-section-inner">
          <p className="lp-kicker">How it works</p>
          <h2>Connectors in. Agents out.</h2>
          <ol className="lp-steps">
            <li>
              <strong>Connect</strong>
              <span>Azure, AWS, GCP, EDR, Git, and SaaS with encrypted credentials.</span>
            </li>
            <li>
              <strong>Discover</strong>
              <span>Run agentless scans that pull live evidence into inventory.</span>
            </li>
            <li>
              <strong>See</strong>
              <span>Use mesh, inventory, and coverage to understand what’s running.</span>
            </li>
          </ol>
        </div>
      </section>

      <section className="lp-finale">
        <div className="lp-finale-inner">
          <p className="lp-brand-word lp-brand-word-sm">Visentra</p>
          <h2>Bring AI agent discovery into view.</h2>
          <p className="lp-section-copy">Sign in to your workspace and start with live connectors — not demo data.</p>
          {isAuthenticated ? (
            <Link className="button primary lp-cta" to="/executive">
              Open platform
            </Link>
          ) : (
            <Link className="button primary lp-cta" to="/login">
              Sign in
            </Link>
          )}
        </div>
      </section>

      <footer className="lp-footer">
        <span>Visentra · Discovery &amp; visibility</span>
        <Link to="/login">Sign in</Link>
      </footer>
    </div>
  );
}
