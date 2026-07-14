import { Link, Navigate } from "react-router-dom";
import { VisentraLogo } from "../components/VisentraLogo";
import { useAuth } from "../lib/auth";

const MOMENTS = [
  {
    id: "discover",
    title: "Discover every agent",
    copy: "Agentless collectors surface IDE, SaaS, cloud, MCP, and framework agents into one trusted inventory — with owners, confidence, and how they were identified."
  },
  {
    id: "classify",
    title: "Classify sensitive data reach",
    copy: "Know which agents can touch PII or PHI from permissions, knowledge sources, and entitlements — with evidence, not guesswork."
  },
  {
    id: "relate",
    title: "Map blast radius and relationships",
    copy: "Follow paths from agents to models, identities, tools, and data stores so high-reach shadow AI rises to the top of the queue."
  },
  {
    id: "change",
    title: "Track change with evidence",
    copy: "New agents, disappeared runtimes, owner shifts, config drift, and data-class escalations — visibility that stays current."
  }
];

function ProductStage() {
  return (
    <div className="landing-stage" aria-hidden="true">
      <div className="landing-stage-frame">
        <div className="landing-stage-chrome">
          <span className="landing-stage-dot" />
          <span className="landing-stage-dot" />
          <span className="landing-stage-dot" />
          <span className="landing-stage-path">Inventory · Data class</span>
        </div>
        <div className="landing-stage-body">
          <div className="landing-stage-side">
            <div className="landing-stage-side-brand">
              <VisentraLogo size={22} />
              <span>Visentra</span>
            </div>
            <div className="landing-stage-nav">
              <span className="on">Executive</span>
              <span>Inventory</span>
              <span>Change intel</span>
              <span>Topology</span>
            </div>
          </div>
          <div className="landing-stage-main">
            <div className="landing-stage-kpis">
              <div>
                <em>13</em>
                <span>Agents</span>
              </div>
              <div>
                <em>4</em>
                <span>PII access</span>
              </div>
              <div>
                <em>1</em>
                <span>PHI access</span>
              </div>
            </div>
            <div className="landing-stage-table">
              <div className="landing-stage-row head">
                <span>Agent</span>
                <span>Class</span>
                <span>Owner</span>
              </div>
              <div className="landing-stage-row">
                <span>M365 Copilot</span>
                <span className="pill pii">PII</span>
                <span>it-admin</span>
              </div>
              <div className="landing-stage-row highlight">
                <span>Bedrock Claims</span>
                <span className="pill phi">PHI</span>
                <span>claims-eng</span>
              </div>
              <div className="landing-stage-row">
                <span>Workday HR Copilot</span>
                <span className="pill pii">PII</span>
                <span>hr-ops</span>
              </div>
              <div className="landing-stage-row">
                <span>Cursor MCP Agent</span>
                <span className="pill none">NONE</span>
                <span>alex.chen</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

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
          <VisentraLogo size={34} />
          <span className="landing-brand-name">Visentra</span>
        </Link>
        <div className="landing-nav-actions">
          <a className="landing-nav-link" href="#capabilities">
            Capabilities
          </a>
          <Link className="button primary landing-nav-cta" to="/login">
            Sign in
          </Link>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-glow" aria-hidden="true" />
        <div className="landing-hero-copy">
          <p className="landing-brand-signal">
            <VisentraLogo size={26} />
            <span>Visentra</span>
          </p>
          <h1 className="landing-headline">See every AI agent before it sees your data.</h1>
          <p className="landing-lede">
            Enterprise discovery and visibility for the AI estate — agentless inventory, sensitive
            data classification, and change intelligence.
          </p>
          <div className="landing-cta-row">
            <Link className="button primary landing-cta" to="/login">
              Sign in
            </Link>
            <a className="landing-cta-ghost" href="#capabilities">
              View capabilities
            </a>
          </div>
        </div>
        <ProductStage />
      </section>

      <section className="landing-audience">
        <p>
          Built for <strong>CISOs</strong>, <strong>AI platform</strong>, and{" "}
          <strong>security operations</strong> teams who need a system of record — not another
          enforcement console.
        </p>
      </section>

      <section className="landing-capabilities" id="capabilities">
        <div className="landing-capabilities-intro">
          <p className="eyebrow">Capabilities</p>
          <h2 className="landing-section-title">Four moves that make the estate visible</h2>
        </div>
        <ol className="landing-moments">
          {MOMENTS.map((moment, index) => (
            <li className="landing-moment" key={moment.id} data-index={String(index + 1).padStart(2, "0")}>
              <h3>{moment.title}</h3>
              <p>{moment.copy}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-close">
        <div className="landing-close-inner">
          <VisentraLogo size={52} />
          <h2>Open the Visentra command center</h2>
          <p>Sign in to investigate inventory, data reach, and change across your AI estate.</p>
          <Link className="button primary landing-cta" to="/login">
            Sign in
          </Link>
        </div>
      </section>

      <footer className="landing-footer">
        <span className="landing-footer-brand">
          <VisentraLogo size={20} /> Visentra
        </span>
        <span>Discovery &amp; Visibility · Agentless by design</span>
      </footer>
    </div>
  );
}
