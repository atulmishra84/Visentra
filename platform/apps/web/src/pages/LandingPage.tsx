import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";

const CAPABILITIES = [
  {
    title: "Agentless discovery",
    body: "Connect the control planes you already run. Visentra classifies agents from live evidence — no Visentra agent on endpoints."
  },
  {
    title: "Living inventory",
    body: "Owners, models, frameworks, presence, and status in one inventory so shadow AI stops being an unknown."
  },
  {
    title: "Global Agent Mesh",
    body: "Project relationships across agents, models, data, and channels — visibility into how the estate connects."
  },
  {
    title: "Coverage you can trust",
    body: "See which sources are connected, what they contributed, and where discovery still has blind spots."
  }
] as const;

const SOURCES = [
  { plane: "Cloud", detail: "Azure · AWS · GCP · Foundry / Bedrock signals" },
  { plane: "Endpoints", detail: "CrowdStrike · Defender · Intune · Cortex · Netskope" },
  { plane: "Build & code", detail: "GitHub · GitLab · Jenkins · IDE / local presence" },
  { plane: "SaaS & identity", detail: "Copilot · Salesforce · Workday · ServiceNow · Entra" }
] as const;

const STEPS = [
  {
    title: "Connect",
    body: "Register cloud, EDR, identity, and SaaS connectors with encrypted credentials."
  },
  {
    title: "Discover",
    body: "Run agentless scans that ingest live evidence into inventory and classification."
  },
  {
    title: "See",
    body: "Explore mesh, relationships, coverage, and shadow AI candidates — visibility only."
  }
] as const;

function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -8% 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, visible };
}

export function LandingPage() {
  const { isAuthenticated } = useAuth();
  const [navScrolled, setNavScrolled] = useState(false);
  const productReveal = useReveal<HTMLElement>();
  const capabilityReveal = useReveal<HTMLUListElement>();
  const stepsReveal = useReveal<HTMLOListElement>();

  useEffect(() => {
    document.documentElement.setAttribute("data-landing", "true");
    return () => document.documentElement.removeAttribute("data-landing");
  }, []);

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const primaryCta = isAuthenticated ? (
    <Link className="lp-btn lp-btn-primary" to="/executive">
      Open platform
    </Link>
  ) : (
    <Link className="lp-btn lp-btn-primary" to="/login">
      Sign in
    </Link>
  );

  return (
    <div className="lp">
      <header className={`lp-nav${navScrolled ? " is-scrolled" : ""}`}>
        <div className="lp-shell lp-nav-inner">
          <Link className="lp-brand" to="/">
            <span className="lp-brand-mark" aria-hidden="true">
              VE
            </span>
            <span className="lp-brand-name">Visentra</span>
          </Link>
          <nav className="lp-nav-links" aria-label="Page sections">
            <a href="#platform">Platform</a>
            <a href="#coverage">Coverage</a>
            <a href="#how">How it works</a>
          </nav>
          <div className="lp-nav-actions">
            {!isAuthenticated ? (
              <Link className="lp-btn lp-btn-ghost" to="/login">
                Sign in
              </Link>
            ) : null}
            {isAuthenticated ? (
              primaryCta
            ) : (
              <Link className="lp-btn lp-btn-primary" to="/login">
                Get started
              </Link>
            )}
          </div>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-media" aria-hidden="true" />
        <div className="lp-hero-shade" aria-hidden="true" />
        <div className="lp-shell lp-hero-copy">
          <p className="lp-kicker">AI agent discovery &amp; visibility</p>
          <p className="lp-brand-hero">Visentra</p>
          <h1 className="lp-headline">See every AI agent in your enterprise.</h1>
          <p className="lp-lede">
            Agentless discovery across cloud, endpoints, SaaS, and code — evidence-backed inventory and mesh for
            security teams.
          </p>
          <div className="lp-cta-row">
            {isAuthenticated ? (
              primaryCta
            ) : (
              <Link className="lp-btn lp-btn-primary lp-btn-lg" to="/login">
                Sign in to Visentra
              </Link>
            )}
            <a className="lp-btn lp-btn-outline lp-btn-lg" href="#platform">
              See the platform
            </a>
          </div>
          <p className="lp-trust">Discovery and visibility only — not enforcement.</p>
        </div>
      </section>

      <section className="lp-section" id="platform">
        <div className="lp-shell">
          <div className="lp-section-head">
            <p className="lp-section-kicker">Platform</p>
            <h2 className="lp-section-title">Inventory and mesh in one command center.</h2>
            <p className="lp-section-copy">
              Visentra turns connector evidence into a living inventory, then projects relationships into Global Agent
              Mesh so you can see what is running and how it connects.
            </p>
          </div>

          <ul
            className="lp-capabilities"
            ref={capabilityReveal.ref}
            data-visible={capabilityReveal.visible ? "true" : "false"}
          >
            {CAPABILITIES.map((item, index) => (
              <li
                key={item.title}
                className={`lp-capability${capabilityReveal.visible ? " is-visible" : ""}`}
                style={{ transitionDelay: capabilityReveal.visible ? `${index * 70}ms` : "0ms" }}
              >
                <span className="lp-capability-index">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="lp-section lp-section-alt">
        <div className="lp-shell lp-product">
          <div className="lp-product-copy">
            <p className="lp-section-kicker">Product</p>
            <h2 className="lp-section-title">Built for security operators, not slideware.</h2>
            <p className="lp-section-copy">
              Dense, evidence-first surfaces for discovery runs, inventory, coverage, and mesh — the same workspace your
              team uses after sign-in.
            </p>
            <ul className="lp-checklist">
              <li>Live connector evidence into classified inventory</li>
              <li>Global Agent Mesh for relationship context</li>
              <li>Coverage map across cloud, EDR, SaaS, and code</li>
            </ul>
          </div>

          <figure
            className={`lp-product-frame${productReveal.visible ? " is-visible" : ""}`}
            ref={productReveal.ref}
          >
            <div className="lp-product-chrome" aria-hidden="true">
              <span className="lp-dot" />
              <span className="lp-dot" />
              <span className="lp-dot" />
              <span>app.visentra · inventory</span>
            </div>
            <img
              src="/images/landing-product-ui.jpg"
              alt="Visentra platform showing inventory and agent mesh"
              width={1920}
              height={1200}
              loading="lazy"
              decoding="async"
            />
          </figure>
        </div>
      </section>

      <section className="lp-section" id="coverage">
        <div className="lp-shell lp-coverage-grid">
          <div className="lp-coverage-lead">
            <p className="lp-section-kicker">Coverage</p>
            <h2 className="lp-section-title">Connect the sources you already trust.</h2>
            <p>
              Pull from cloud control planes, EDR estates, identity, CI, and SaaS platforms. Your existing tooling is the
              sensor — Visentra does not require another agent on the endpoint.
            </p>
          </div>
          <ul className="lp-source-list">
            {SOURCES.map((source) => (
              <li key={source.plane}>
                <strong>{source.plane}</strong>
                <span>{source.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="lp-section lp-section-alt" id="how">
        <div className="lp-shell">
          <div className="lp-section-head">
            <p className="lp-section-kicker">How it works</p>
            <h2 className="lp-section-title">Three steps from blind spot to visibility.</h2>
            <p className="lp-section-copy">Connectors in. Evidence classified. The estate visible.</p>
          </div>
          <ol
            className="lp-steps"
            ref={stepsReveal.ref}
            data-visible={stepsReveal.visible ? "true" : "false"}
          >
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                className={stepsReveal.visible ? "is-visible" : undefined}
                style={{ transitionDelay: stepsReveal.visible ? `${index * 90}ms` : "0ms" }}
              >
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="lp-section lp-section-finale">
        <div className="lp-shell lp-finale-inner">
          <p className="lp-section-kicker">Visentra</p>
          <h2 className="lp-section-title">Know what AI is running in your environment.</h2>
          <p className="lp-section-copy">
            Start with live connectors in your workspace. Discovery and visibility — not governance or enforcement.
          </p>
          <div className="lp-cta-row">
            {isAuthenticated ? (
              <Link className="lp-btn lp-btn-primary lp-btn-lg" to="/executive">
                Open platform
              </Link>
            ) : (
              <Link className="lp-btn lp-btn-primary lp-btn-lg" to="/login">
                Sign in to Visentra
              </Link>
            )}
          </div>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-shell lp-footer-inner">
          <div className="lp-footer-brand">Visentra</div>
          <p className="lp-footer-meta">Discovery &amp; visibility for enterprise AI agents</p>
          <p className="lp-footer-copy">
            <Link to="/login">Sign in</Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
