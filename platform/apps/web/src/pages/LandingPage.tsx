import { Link, Navigate } from "react-router-dom";
import { VisentraLogo } from "../components/VisentraLogo";
import { useAuth } from "../lib/auth";

const TOOLS = [
  {
    name: "Agent inventory",
    summary: "Canonical catalog of agents across IDE, SaaS, cloud, MCP, and frameworks — with owners and confidence."
  },
  {
    name: "Sensitive data class",
    summary: "Classify what agents can reach — PII, PHI, secrets — from permissions and knowledge sources, with evidence."
  },
  {
    name: "Config & access map",
    summary: "See tools, MCP, knowledge, channels, auth mode, and granted scopes on every agent profile."
  },
  {
    name: "Blast radius",
    summary: "Score reach across graph edges, identity, and high-sensitivity access to prioritize investigation."
  },
  {
    name: "Change intelligence",
    summary: "Track newly discovered, disappeared, owner changes, config drift, and data-class escalations."
  },
  {
    name: "Coverage & Shadow AI",
    summary: "Map connector coverage and surface unmanaged or ownerless agents before they become blind spots."
  },
  {
    name: "Topology & relationships",
    summary: "Explore how agents connect to models, tools, identities, repositories, and external services."
  },
  {
    name: "Usage analytics",
    summary: "Understand models, frameworks, cloud, and IDE adoption across the estate — visibility only, no enforcement."
  }
];

export function LandingPage() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <div className="loading-state">Loading Visentra...</div>;
  }

  if (isAuthenticated) {
    return <Navigate to="/executive" replace />;
  }

  return (
    <div className="landing-page">
      <header className="landing-nav">
        <Link className="landing-brand" to="/" aria-label="Visentra home">
          <VisentraLogo size={36} />
          <span className="landing-brand-name">Visentra</span>
        </Link>
        <div className="landing-nav-actions">
          <a className="landing-nav-link" href="#tools">
            Platform
          </a>
          <Link className="button primary landing-nav-cta" to="/login">
            Sign in
          </Link>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-atmosphere" aria-hidden="true" />
        <div className="landing-hero-inner">
          <p className="landing-brand-signal">
            <VisentraLogo size={28} />
            <span>Visentra</span>
          </p>
          <h1 className="landing-headline">See every AI agent before it sees your data.</h1>
          <p className="landing-lede">
            Agentless discovery and visibility for the enterprise AI estate — inventory, access,
            sensitive data reach, and change intelligence in one place.
          </p>
          <div className="landing-cta-row">
            <Link className="button primary landing-cta" to="/login">
              Sign in
            </Link>
            <a className="button landing-cta-secondary" href="#tools">
              Explore the platform
            </a>
          </div>
        </div>
      </section>

      <section className="landing-tools" id="tools">
        <div className="landing-tools-inner">
          <p className="eyebrow">Platform</p>
          <h2 className="landing-section-title">Built for discovery, not enforcement</h2>
          <p className="landing-section-copy">
            Visentra maps agents, relationships, and data reach across your estate — so security and
            platform teams can investigate with evidence.
          </p>
          <ul className="landing-tool-list">
            {TOOLS.map((tool) => (
              <li className="landing-tool" key={tool.name}>
                <h3>{tool.name}</h3>
                <p>{tool.summary}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="landing-close">
        <div className="landing-close-inner">
          <VisentraLogo size={48} />
          <h2>Ready to map your AI estate?</h2>
          <p>Sign in to open the Visentra command center.</p>
          <Link className="button primary landing-cta" to="/login">
            Sign in
          </Link>
        </div>
      </section>

      <footer className="landing-footer">
        <span className="landing-footer-brand">
          <VisentraLogo size={20} /> Visentra
        </span>
        <span className="muted">Discovery &amp; Visibility</span>
      </footer>
    </div>
  );
}
