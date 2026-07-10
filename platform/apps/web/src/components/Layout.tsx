import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { FormEvent, useEffect, useState } from "react";
import { connectGraphStream } from "../lib/api";
import { useAuth } from "../lib/auth";

const sections = [
  {
    heading: "Dashboards",
    items: [
      { to: "/executive", label: "Executive Overview" },
      { to: "/operations", label: "Operations Workbench" },
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
      { to: "/search", label: "Global Search" }
    ]
  },
  {
    heading: "Settings",
    items: [{ to: "/settings/connectors", label: "Connectors" }]
  }
];

export function Layout() {
  const { user, logout, token } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [streamStatus, setStreamStatus] = useState<"connecting" | "live" | "error">("connecting");

  useEffect(() => {
    if (!token) {
      return;
    }

    const stream = connectGraphStream(
      (event) => {
        window.dispatchEvent(
          new CustomEvent("agentradar:graph-event", {
            detail: {
              type: event.type,
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
          {sections.map((section) => (
            <div className="nav-section" key={section.heading}>
              <div className="nav-heading">{section.heading}</div>
              {section.items.map((item) => (
                <NavLink className="nav-link" key={item.to} to={item.to}>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
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
