import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { connectGraphStream } from "../lib/api";
import { useAuth } from "../lib/auth";
import { getPreferredTheme, toggleTheme, type ThemeMode } from "../lib/theme";

const sections = [
  {
    heading: "Dashboards",
    items: [
      { to: "/executive", label: "Executive Overview" },
      { to: "/mesh", label: "Global Agent Mesh" },
      { to: "/operations", label: "Operations Workbench" },
      { to: "/shadow-ai", label: "Shadow AI" },
      { to: "/discovery", label: "Discovery" }
    ]
  },
  {
    heading: "Inventory",
    items: [
      { to: "/inventory", label: "Asset Inventory" },
      { to: "/inventory/explorer", label: "Inventory Explorer" },
      { to: "/topology", label: "Topology Map" },
      { to: "/relationships", label: "Relationship Explorer" }
    ]
  },
  {
    heading: "Usage Analytics",
    items: [
      { to: "/usage/models", label: "Model Usage" },
      { to: "/usage/frameworks", label: "Framework Usage" },
      { to: "/usage/cloud", label: "Cloud Usage" },
      { to: "/usage/ide", label: "IDE Usage" }
    ]
  },
  {
    heading: "Activity",
    items: [
      { to: "/timeline", label: "Agent Timeline" },
      { to: "/discovery/events", label: "Discovery Events" },
      { to: "/discovery/changes", label: "Change Intelligence" },
      { to: "/coverage", label: "Coverage Map" },
      { to: "/search", label: "Global Search" }
    ]
  },
  {
    heading: "Settings",
    items: [
      { to: "/settings/connectors", label: "Connectors" },
      { to: "/settings/audit", label: "Audit Log" }
    ]
  }
];

function activeSectionHeading(pathname: string): string | null {
  // Longest matching path wins so /discovery/changes maps to Activity, not Dashboards Discovery.
  let best: { heading: string; len: number } | null = null;
  for (const section of sections) {
    for (const item of section.items) {
      const matches = pathname === item.to || pathname.startsWith(`${item.to}/`);
      if (!matches) continue;
      if (!best || item.to.length > best.len) {
        best = { heading: section.heading, len: item.to.length };
      }
    }
  }
  return best?.heading ?? null;
}

export function Layout() {
  const { user, logout, token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState("");
  const [streamStatus, setStreamStatus] = useState<"connecting" | "live" | "error">("connecting");
  const [theme, setTheme] = useState<ThemeMode>(() => getPreferredTheme());
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(sections.map((section) => [section.heading, true]))
  );

  const currentSection = useMemo(() => activeSectionHeading(location.pathname), [location.pathname]);

  useEffect(() => {
    if (!currentSection) return;
    setOpenSections((prev) => (prev[currentSection] ? prev : { ...prev, [currentSection]: true }));
  }, [currentSection]);

  useEffect(() => {
    if (!token) {
      return;
    }

    const stream = connectGraphStream(
      (event) => {
        const type = event.type;
        if (!type || type === "message" || type === "connected" || type === "error") return;
        window.dispatchEvent(
          new CustomEvent("agentradar:graph-event", {
            detail: {
              type,
              data: event.data
            }
          })
        );
      },
      setStreamStatus
    );

    return () => stream.close();
  }, [token]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    navigate(`/search?q=${encodeURIComponent(search.trim())}`);
  };

  const toggleSection = (heading: string) => {
    setOpenSections((prev) => ({ ...prev, [heading]: !prev[heading] }));
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">AR</div>
          <div>
            <div className="brand-title">AgentRadar</div>
            <div className="brand-subtitle">Discovery & Visibility</div>
          </div>
        </div>

        <nav aria-label="Primary navigation">
          {sections.map((section) => {
            const open = Boolean(openSections[section.heading]);
            const panelId = `nav-panel-${section.heading.replace(/\s+/g, "-").toLowerCase()}`;
            const isActiveSection = currentSection === section.heading;

            return (
              <div className={`nav-section ${open ? "open" : "collapsed"}`} key={section.heading}>
                <button
                  type="button"
                  className={`nav-heading-button ${isActiveSection ? "active-section" : ""}`}
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => toggleSection(section.heading)}
                >
                  <span>{section.heading}</span>
                  <span className={`nav-chevron ${open ? "open" : ""}`} aria-hidden="true" />
                </button>
                <div className="nav-panel" id={panelId} hidden={!open}>
                  {section.items.map((item) => (
                    <NavLink className="nav-link" key={item.to} to={item.to} end={item.to === "/discovery"}>
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <form className="search-box" onSubmit={submitSearch}>
            <span aria-hidden="true">⌕</span>
            <input
              aria-label="Global search"
              placeholder="Search agents, models, owners, repositories..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <kbd>/</kbd>
          </form>

          <div className="toolbar">
            <button
              className="theme-toggle"
              type="button"
              aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
              onClick={() => setTheme(toggleTheme(theme))}
            >
              {theme === "light" ? "Dark" : "Light"}
            </button>
            <span className="status-pill">
              <span
                className={`status-dot ${
                  streamStatus === "live" ? "live" : streamStatus === "error" ? "error" : "warn"
                }`}
              />
              Graph stream {streamStatus}
            </span>
            <span className="status-pill">{String(user?.tenant ?? user?.email ?? "Tenant")}</span>
            <button className="button ghost" type="button" onClick={logout}>
              Sign out
            </button>
          </div>
        </header>

        <Outlet />
      </main>
    </div>
  );
}
