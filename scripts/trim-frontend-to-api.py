#!/usr/bin/env python3
"""Trim AgentRadar frontend to features backed by a real backend API.

REMOVE (demo / local-only / stub):
  - Live Detection, Model Registry, Blast Radius, Lineage, Benchmark, Notifications
  - Fake Scan, Demo/Live toggle, AI Agent panel, Anthropic playbook chat
  - Endpoint scanner stubs (Cortex / CrowdStrike / Intune)
  - Bulk Import (local-only), fake tenant cycle, SSO teaser
  - Webhook localStorage UI replaced by API hydrate (keep modal, rewire)

KEEP (API or derived from API agents):
  - Login, Dashboard, Discovery, Shadow, PHI, Compliance, Risk, CISO
  - Policy / Approvals / Playbooks / Activity / Integrations creds / Auto-Discover
  - Register agent, Export CSV, Evidence package (from loaded agents)
"""
from pathlib import Path
import re

path = Path("/workspace/index.html")
html = path.read_text(encoding="utf-8")

# ---------------------------------------------------------------------------
# 1) Remove non-functional sidebar nav items
# ---------------------------------------------------------------------------
REMOVE_NAV = ("live", "models", "blast", "lineage", "benchmark", "notifications")
for vid in REMOVE_NAV:
    html = re.sub(
        rf'\s*<div class="nav-item"[^>]*id="nav-{vid}"[^>]*>.*?</div>\s*',
        "\n",
        html,
        count=1,
        flags=re.DOTALL,
    )

# Remove nav section labels that become empty-ish — leave structure alone

# ---------------------------------------------------------------------------
# 2) Hide non-functional view roots (keep in DOM so JS refs don't explode)
# ---------------------------------------------------------------------------
for vid in REMOVE_NAV:
    html = re.sub(
        rf'(<div class="view[^"]*" id="view-{vid}")',
        rf'\1 style="display:none!important" data-removed="no-backend"',
        html,
        count=1,
    )

# ---------------------------------------------------------------------------
# 3) Top bar: remove Scan, AI Agent, Demo toggle, notif bell, Import
# ---------------------------------------------------------------------------
html = re.sub(
    r'\s*<button class="btn ai sm" id="btn-ai-agent" onclick="toggleAgentPanel\(\)">.*?</button>\s*',
    "\n",
    html,
    count=1,
    flags=re.DOTALL,
)
html = re.sub(
    r'\s*<button class="btn primary sm" onclick="startScan\(\)">.*?</button>\s*',
    "\n",
    html,
    count=1,
    flags=re.DOTALL,
)
html = re.sub(
    r'\s*<button class="btn sm" id="btn-import" onclick="openModal\(\'modal-import\'\)">.*?</button>\s*',
    "\n",
    html,
    count=1,
    flags=re.DOTALL,
)
html = re.sub(
    r'\s*<button id="btn-mode-switch" onclick="toggleScannerMode\(\)"[^>]*>.*?</button>\s*',
    "\n",
    html,
    count=1,
    flags=re.DOTALL,
)
html = re.sub(
    r'\s*<div class="notif-btn" onclick="go\(\'notifications\'\)">.*?</div>\s*',
    "\n",
    html,
    count=1,
    flags=re.DOTALL,
)

# ---------------------------------------------------------------------------
# 4) Dashboard quick-actions that point at removed features
# ---------------------------------------------------------------------------
html = re.sub(
    r'\s*<button class="qa-btn" onclick="startScan\(\)"[^>]*>.*?</button>\s*',
    "\n",
    html,
    count=1,
    flags=re.DOTALL,
)
html = re.sub(
    r'\s*<button class="qa-btn" onclick="go\(\'lineage\'\)"[^>]*>.*?</button>\s*',
    "\n",
    html,
    count=1,
    flags=re.DOTALL,
)
html = re.sub(
    r'\s*<button class="qa-btn" onclick="toggleAgentPanel\(\)"[^>]*>.*?</button>\s*',
    "\n",
    html,
    count=1,
    flags=re.DOTALL,
)

# ---------------------------------------------------------------------------
# 5) Login SSO teaser (SSO returns 501)
# ---------------------------------------------------------------------------
html = re.sub(
    r'\s*<div style="margin-top:10px;text-align:center;font-size:11px;color:var\(--text-muted\)">SSO / SAML available for enterprise accounts</div>\s*',
    "\n",
    html,
    count=1,
)

# ---------------------------------------------------------------------------
# 6) Disable fake tenant cycling — show static label only
# ---------------------------------------------------------------------------
html = html.replace(
    "function cycleTenant(){DB.ct=(DB.ct+1)%DB.tenants.length;const t=DB.tenants[DB.ct];document.getElementById('tname').textContent=t.n;document.getElementById('tdot').style.background=t.c;save();}",
    "function cycleTenant(){ /* multi-tenant switcher disabled — tenant comes from JWT */ }",
)

# ---------------------------------------------------------------------------
# 7) Disable fake scan + AI agent + Anthropic playbook chat
# ---------------------------------------------------------------------------
html = html.replace(
    "function startScan(){",
    "function startScan(){ alert('Full environment scan requires connected scanner integrations (not configured on this deployment).'); return;\nfunction __startScan_disabled(){",
)
html = html.replace(
    "function toggleAgentPanel(){",
    "function toggleAgentPanel(){ alert('AI Agent requires a configured LLM provider (not available on this deployment).'); return;\nfunction __toggleAgentPanel_disabled(){",
)
html = html.replace(
    "async function askPB(){",
    "async function askPB(){ alert('Playbook AI assistant requires a configured LLM provider.'); return;\nasync function __askPB_disabled(){",
)
html = html.replace(
    "function toggleScannerMode(){",
    "function toggleScannerMode(){ return; // demo/live toggle removed\nfunction __toggleScannerMode_disabled(){",
)

# Hide playbook AI chat input area if present
html = re.sub(
    r'(<div[^>]*id="pb-chat"[^>]*>)',
    r'<div style="display:none!important" data-removed="no-llm-backend"><!-- playbook AI chat removed -->\n\1',
    html,
    count=1,
)

# ---------------------------------------------------------------------------
# 8) Hide endpoint stub scanner cards (Cortex / CrowdStrike / Intune)
#    These POST to /api/endpoint/scan/* which returns demo:true stubs.
# ---------------------------------------------------------------------------
# Wrap the three endpoint connector blocks — find by distinctive headers
for label in ("Cortex XDR", "CrowdStrike Falcon", "Microsoft Intune"):
    # Mark status badges so users don't think they're live — hide whole card if we can find a parent
    pass

# Disable JS that calls stub endpoint scans
html = re.sub(
    r"fetch\('/api/endpoint/scan/cortex'",
    "/* stub removed */ void fetch('/api/endpoint/scan/cortex-disabled'",
    html,
)
html = re.sub(
    r"fetch\('/api/endpoint/scan/crowdstrike'",
    "/* stub removed */ void fetch('/api/endpoint/scan/crowdstrike-disabled'",
    html,
)
html = re.sub(
    r"fetch\('/api/endpoint/scan/intune'",
    "/* stub removed */ void fetch('/api/endpoint/scan/intune-disabled'",
    html,
)

# Hide endpoint detection section in integrations if marked
html = re.sub(
    r'(<!-- Cortex XDR -->)',
    r'<div style="display:none!important" data-removed="endpoint-stubs-demo-only">\n\1',
    html,
    count=1,
)
# Close after Intune block — find a marker after intune inputs
if 'data-removed="endpoint-stubs-demo-only"' in html and "<!-- ENDPOINT_STUBS_END -->" not in html:
    # Close the hidden div after the intune secret input block's parent ends.
    # Look for the next major comment after Intune section.
    html = re.sub(
        r'(id="cd-intune-secret"[^>]*>.*?</div>\s*</div>\s*</div>)',
        r'\1\n</div><!-- ENDPOINT_STUBS_END -->',
        html,
        count=1,
        flags=re.DOTALL,
    )

# ---------------------------------------------------------------------------
# 9) Clear seed demo data that is not from API (keep empty shells)
# ---------------------------------------------------------------------------
# Replace seeded models/notifications/approvals/activity/risks with empty defaults
# so UI doesn't show fake Healthcare Global data before/without API hydrate.
html = re.sub(
    r"models:\s*\[(?:.|\n)*?\],\s*policies:",
    "models:[],\n  policies:",
    html,
    count=1,
)
html = re.sub(
    r"approvals:\s*\[(?:.|\n)*?\],\s*apprHist:",
    "approvals:[],\n  apprHist:[],\n  _apprHist_removed:",
    html,
    count=1,
)
# Fix accidental double — clean _apprHist_removed line if we broke structure
html = re.sub(
    r"apprHist:\[\],\s*_apprHist_removed:\s*\[(?:.|\n)*?\],\s*notifications:",
    "apprHist:[],\n  notifications:",
    html,
    count=1,
)
html = re.sub(
    r"notifications:\s*\[(?:.|\n)*?\],\s*activity:",
    "notifications:[],\n  activity:",
    html,
    count=1,
)
html = re.sub(
    r"activity:\s*\[(?:.|\n)*?\],\s*tenants:",
    "activity:[],\n  tenants:",
    html,
    count=1,
)
html = re.sub(
    r"risks:\s*\[(?:.|\n)*?\],\s*models:",
    "risks:[],\n  models:",
    html,
    count=1,
)

# ---------------------------------------------------------------------------
# 10) Guard go() + hydrate governance/activity/webhooks from real APIs
# ---------------------------------------------------------------------------
# Remove any previous inject
html = re.sub(
    r"<script>\s*/\* AgentRadar: only show UI backed by real APIs \*/(?:.|\n)*?</script>\s*",
    "",
    html,
    count=1,
)

inject = r"""
<script>
/* AgentRadar: frontend trimmed to API-backed features only */
(function () {
  const BLOCKED = new Set(['live','models','blast','lineage','benchmark','notifications']);

  function patchGo() {
    const orig = window.go;
    if (typeof orig !== 'function' || orig.__arPatched) return;
    function goGuarded(v) {
      if (BLOCKED.has(v)) {
        alert('This module is not available — no backend API on this deployment.');
        return orig('discovery');
      }
      return orig(v);
    }
    goGuarded.__arPatched = true;
    window.go = goGuarded;
  }

  async function arFetch(path, opts) {
    const token = localStorage.getItem('ar_token') || (typeof _apiToken !== 'undefined' ? _apiToken : '');
    const headers = Object.assign({ 'Content-Type': 'application/json' }, (opts && opts.headers) || {});
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(path, Object.assign({}, opts || {}, { headers, credentials: 'include' }));
    if (!res.ok) throw new Error(path + ' ' + res.status);
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : res.text();
  }

  async function hydrateGovernance() {
    if (typeof DB === 'undefined') return;
    try {
      const policies = await arFetch('/api/governance/policies');
      const list = Array.isArray(policies) ? policies : (policies.policies || []);
      if (list.length) {
        DB.policies = list.map((p, i) => ({
          id: p.id || i + 1,
          name: p.name,
          desc: p.description || p.desc || '',
          cond: (p.rules && p.rules.cond) || p.policy_type || 'custom',
          act: (p.rules && p.rules.act) || 'flag',
          on: (p.status || 'active') === 'active' || p.status === 'enforced',
        }));
        if (typeof renderPolicy === 'function' && typeof cv !== 'undefined' && cv === 'policy') renderPolicy();
      }
    } catch (e) { console.warn('policies hydrate', e); }

    try {
      const approvals = await arFetch('/api/governance/approvals');
      const list = Array.isArray(approvals) ? approvals : (approvals.approvals || []);
      DB.approvals = list.map((a, i) => ({
        id: a.id || i + 1,
        aid: a.agent_id || a.aid,
        stage: a.status === 'pending' ? 'pending' : (a.status || a.stage || 'pending'),
        by: a.requester_email || a.requester || a.by || 'system',
        note: a.description || a.note || a.title || '',
        at: (a.created_at || '').slice(0, 10),
      }));
      if (typeof renderAppr === 'function' && typeof cv !== 'undefined' && cv === 'approvals') renderAppr();
    } catch (e) { console.warn('approvals hydrate', e); }

    try {
      const playbooks = await arFetch('/api/governance/playbooks');
      const list = Array.isArray(playbooks) ? playbooks : (playbooks.playbooks || []);
      if (list.length && typeof window !== 'undefined') {
        window.__apiPlaybooks = list;
      }
    } catch (e) { console.warn('playbooks hydrate', e); }

    try {
      const acts = await arFetch('/api/activity?limit=100');
      const list = Array.isArray(acts) ? acts : (acts.activities || acts.items || []);
      if (list.length) {
        DB.activity = list.map((a) => ({
          type: a.action || a.type || 'info',
          t: a.detail || a.details || a.action || '',
          m: (a.actor_email || a.actor || 'system') + ' · ' + (a.created_at || ''),
          c: a.severity === 'critical' ? '#ef4444' : '#6366f1',
        }));
        if (typeof renderAct === 'function' && typeof cv !== 'undefined' && cv === 'activity') renderAct();
      }
    } catch (e) { console.warn('activity hydrate', e); }

    try {
      const hooks = await arFetch('/api/webhooks');
      const list = Array.isArray(hooks) ? hooks : (hooks.webhooks || []);
      // Prefer API webhooks over localStorage demo list
      if (typeof window !== 'undefined') {
        window.__apiWebhooks = list;
        const el = document.getElementById('webhook-list');
        if (el && list.length) {
          el.innerHTML = list.map((w) =>
            '<div class="webhook-row"><span style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis">' +
            (w.name || w.url) + '</span><span style="font-size:10px;color:var(--text-muted)">' +
            ((w.events || []).join(', ') || 'all') + '</span></div>'
          ).join('');
        }
      }
    } catch (e) { console.warn('webhooks hydrate', e); }

    if (typeof updateStats === 'function') updateStats();
  }

  // Patch go as soon as it exists
  const ready = setInterval(() => {
    if (typeof window.go === 'function') {
      patchGo();
      clearInterval(ready);
    }
  }, 50);

  // Hydrate after live agents load
  const wrapLoad = setInterval(() => {
    if (typeof window.loadLiveAgents === 'function' && !window.loadLiveAgents.__arPatched) {
      const orig = window.loadLiveAgents;
      window.loadLiveAgents = async function () {
        const r = await orig.apply(this, arguments);
        setTimeout(hydrateGovernance, 200);
        return r;
      };
      window.loadLiveAgents.__arPatched = true;
      clearInterval(wrapLoad);
    }
  }, 50);

  document.addEventListener('DOMContentLoaded', () => {
    patchGo();
    // Remove AI agent chrome if present
    ['btn-ai-agent', 'agent-panel', 'ai-agent-panel'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
    // Hide Anthropic key banner/modal prompts
    const akb = document.getElementById('akb-overlay') || document.querySelector('.akb-title');
    if (akb) {
      const root = akb.closest('.modal') || akb.closest('[id]') || akb.parentElement;
      if (root) root.style.display = 'none';
    }
  });
})();
</script>
"""

if "frontend trimmed to API-backed features only" not in html:
    html = html.replace("</body>", inject + "\n</body>")

path.write_text(html, encoding="utf-8")
print(f"Wrote {path} ({len(html)} bytes)")

# Verification
checks = [
    ("nav-live removed", 'id="nav-live"' not in html),
    ("nav-models removed", 'id="nav-models"' not in html),
    ("nav-blast removed", 'id="nav-blast"' not in html),
    ("nav-lineage removed", 'id="nav-lineage"' not in html),
    ("nav-benchmark removed", 'id="nav-benchmark"' not in html),
    ("nav-notifications removed", 'id="nav-notifications"' not in html),
    ("nav-discovery kept", 'id="nav-discovery"' in html),
    ("nav-policy kept", 'id="nav-policy"' in html),
    ("nav-activity kept", 'id="nav-activity"' in html),
    ("AI agent btn removed", 'id="btn-ai-agent"' not in html),
    ("startScan btn removed", 'onclick="startScan()"' not in html),
    ("demo toggle removed", "btn-mode-switch" not in html),
    ("import btn removed", 'id="btn-import"' not in html),
    ("inject present", "frontend trimmed to API-backed features only" in html),
    ("askPB disabled", "__askPB_disabled" in html),
    ("seed models empty", re.search(r"models:\[\],", html) is not None),
]
for label, ok in checks:
    print(("OK  " if ok else "FAIL") + "  " + label)
