(function () {
  const pages = [
    { href: "index.html", label: "Prototype Gallery", section: "Prototypes" },
    { href: "executive.html", label: "Executive Overview", section: "Dashboards" },
    { href: "mesh.html", label: "Global Agent Mesh", section: "Dashboards" },
    { href: "operations.html", label: "Operations Workbench", section: "Dashboards" },
    { href: "shadow-ai.html", label: "Shadow AI", section: "Dashboards" },
    { href: "discovery.html", label: "Discovery", section: "Dashboards" },
    { href: "adversarial.html", label: "Attack Surface", section: "Dashboards" },
    { href: "phi-pii-exposure.html", label: "PHI / PII Exposure", section: "Dashboards" },
    { href: "inventory.html", label: "Asset Inventory", section: "Inventory" }
  ];

  const current = (location.pathname.split("/").pop() || "index.html").toLowerCase();

  function sectionHtml(name) {
    const items = pages
      .filter((p) => p.section === name)
      .map((p) => {
        const active = p.href === current ? " active" : "";
        return `<a class="nav-link${active}" href="${p.href}">${p.label}</a>`;
      })
      .join("");
    return `<div class="nav-section"><span class="nav-heading">${name}</span>${items}</div>`;
  }

  const shell = document.getElementById("app-shell");
  if (!shell) return;

  const main = shell.querySelector(".main") || shell.firstElementChild;
  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar";
  sidebar.innerHTML = `
    <a class="brand" href="index.html">
      <span class="brand-mark" aria-hidden="true"></span>
      <span class="brand-copy">
        <strong>Visentra</strong>
        <span>AgentRadar · prototypes</span>
      </span>
    </a>
    ${sectionHtml("Prototypes")}
    ${sectionHtml("Dashboards")}
    ${sectionHtml("Inventory")}
    <div class="sidebar-footer">
      <div>Static HTML mock data</div>
      <div class="mono">v0.1 · dashboards</div>
    </div>
  `;
  shell.insertBefore(sidebar, main);

  const topbar = document.createElement("div");
  topbar.className = "topbar";
  topbar.innerHTML = `
    <label class="topbar-search">
      <span aria-hidden="true">⌕</span>
      <input type="search" placeholder="Search agents, owners, models…" disabled />
    </label>
    <div class="topbar-meta">
      <span class="status-pill">Prototype</span>
      <span>Acme · Production</span>
    </div>
  `;
  main.insertBefore(topbar, main.firstChild);
})();
