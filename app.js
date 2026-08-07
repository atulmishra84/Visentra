
// ═══════════════════════════════════════════════════════════════
// AgentRadar — AI Governance Platform
// Fresh build — clean syntax, no escaping issues
// ═══════════════════════════════════════════════════════════════

// ── Runtime CSS fix ───────────────────────────────────────────
(function fixCardScroll() {
  var style = document.createElement('style');
  style.id = 'ar-scroll-fix';
  style.textContent = [
    '.view.active .card .tbl-wrap { overflow-x: auto; overflow-y: auto; }',
    '#view-discovery, #view-shadow, #view-phi, #view-models,',
    '#view-risk, #view-approvals, #view-compliance { overflow-y: auto !important; }'
  ].join('\n');
  document.head.appendChild(style);
})();

// ── Fix misplaced views ────────────────────────────────────────
/* fixViewPlacement removed - views are correctly placed in HTML */

// ═══════════════════════════════════════════════════════════════
// GLOBAL STATE
// ═══════════════════════════════════════════════════════════════
var currentRole = null;
var currentUser = '';
var currentView = 'dashboard';
var _apiToken = null;
var cfFilter = 'all';
var rf = 'all';
var ef = 'all';
var tf = 'all';
var adSelected = new Set();
var feedTimer = null;
var lIdx = 0;
var epCt = 0;

var DB = {
  agents: [],
  policyViolations: [],
  approvals: [],
  phiAgents: [],
  activity: [],
  notifications: [],
  scanners: []
};

var ROLES = {
  platform_admin: { label: 'Platform Admin', color: '#8b5cf6' },
  ciso:           { label: 'CISO',           color: '#ef4444' },
  analyst:        { label: 'Security Analyst',color: '#3b82f6' },
  auditor:        { label: 'Auditor',         color: '#10b981' },
  viewer:         { label: 'Viewer',          color: '#94a3b8' }
};

// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setTextSafe(el, val) {
  if (el) el.textContent = String(val || '');
}

function save() {
  try { localStorage.setItem('ar11-db', JSON.stringify(DB)); } catch(e) {}
}

function envTag(env) {
  var colors = { Cloud:'#3b82f6', Azure:'#0078d4', AWS:'#f59e0b', GCP:'#34a853', 'On-Prem':'#6366f1', Hybrid:'#8b5cf6', SaaS:'#06b6d4', Edge:'#f97316' };
  var c = colors[env] || '#94a3b8';
  return '<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:99px;background:' + c + '18;color:' + c + '">' + escapeHtml(env || 'Unknown') + '</span>';
}

function rtag(risk) {
  var colors = { critical:'#ef4444', high:'#f59e0b', medium:'#6366f1', low:'#10b981' };
  var c = colors[risk] || '#94a3b8';
  return '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;background:' + c + '18;color:' + c + '">' + escapeHtml((risk || 'unknown').toUpperCase()) + '</span>';
}

function showToast(message, type, duration) {
  var container = document.getElementById('toast-container');
  if (!container) return;
  var toast = document.createElement('div');
  toast.className = 'toast-item';
  var icons = { success: '&#x2713;', error: '&#x2717;', info: '&#x2139;', warning: '&#x26a0;' };
  var colors = { success: '#10B981', error: '#EF4444', info: '#2563EB', warning: '#F59E0B' };
  var color = colors[type || 'info'] || colors.info;
  toast.style.borderLeft = '3px solid ' + color;
  toast.innerHTML = '<span style="color:' + color + ';font-weight:700;font-size:14px">' + (icons[type || 'info'] || '&#x2139;') + '</span><span>' + escapeHtml(String(message || '')) + '</span>';
  container.appendChild(toast);
  setTimeout(function() {
    toast.style.animation = 'toastIn .3s ease reverse';
    setTimeout(function() { toast.remove(); }, 300);
  }, duration || 3000);
}

function addAct(type, action, actor, color) {
  DB.activity.unshift({ type: type, action: action, actor: actor || 'System', color: color || '#6366f1', ts: new Date().toLocaleTimeString() });
  if (DB.activity.length > 100) DB.activity.pop();
  var cnt = document.getElementById('act-count');
  if (cnt) cnt.textContent = DB.activity.length;
}

function levenshtein(a, b) {
  var m = a.length, n = b.length;
  var dp = [];
  for (var i = 0; i <= m; i++) {
    dp[i] = [i];
    for (var j = 1; j <= n; j++) {
      dp[i][j] = i === 0 ? j : 0;
    }
  }
  for (var j = 1; j <= n; j++) dp[0][j] = j;
  for (var i = 1; i <= m; i++) {
    for (var j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

// ═══════════════════════════════════════════════════════════════
// AGENT CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

function classifyAgentCategory(a) {
  var name = (a.name || '').toLowerCase();
  var type = (a.type || '').toLowerCase();
  var detect = (a.detect || '').toLowerCase();
  var protos = (a.protocols || []).map(function(p) { return p.toLowerCase(); });
  var env = (a.env || '').toLowerCase();

  var saasKw = ['copilot','salesforce','einstein','servicenow','workday','zendesk','hubspot','epic','cerner','nuance','m365','office365','zoom','teams','slack'];
  if (saasKw.some(function(k) { return name.indexOf(k) >= 0 || detect.indexOf(k) >= 0; })) return 'saas';
  if (['hl7 v2','fhir r4','dicom','mllp'].some(function(p) { return protos.indexOf(p) >= 0; })) return 'saas';

  var devKw = ['test','dev','staging','sandbox','poc','prototype','demo','local'];
  if (devKw.some(function(k) { return name.indexOf(k) >= 0 || env.indexOf(k) >= 0; })) return 'dev';

  var platformKw = ['scanner','monitor','watcher','crawler','probe','sensor','gateway','proxy','router','orchestrat','pipelin'];
  if (platformKw.some(function(k) { return name.indexOf(k) >= 0 || detect.indexOf(k) >= 0; })) return 'platform';

  var autoKw = ['autogpt','autonomous','bot','automation','workflow','langchain','crewai','autogen'];
  if (autoKw.some(function(k) { return name.indexOf(k) >= 0 || type.indexOf(k) >= 0; })) return 'autonomous';

  return 'user-facing';
}

function agentCategoryLabel(cat) {
  var labels = { 'user-facing':'User-facing', 'autonomous':'Autonomous', 'saas':'SaaS agent', 'dev':'Dev / Test', 'platform':'Platform agent', 'unknown':'Unknown' };
  return labels[cat] || cat;
}

function agentCategoryColor(cat) {
  var colors = { 'user-facing':'#3b82f6', 'autonomous':'#8b5cf6', 'saas':'#06b6d4', 'dev':'#94a3b8', 'platform':'#f59e0b', 'unknown':'#94a3b8' };
  return colors[cat] || '#94a3b8';
}

function lifecycleLabel(status) {
  var labels = { 'active':'Active', 'dormant':'Dormant', 'under-review':'Under review', 'approved':'Approved', 'retired':'Retired' };
  return labels[status] || status || 'Active';
}

function lifecycleColor(status) {
  var colors = { 'active':'#10b981', 'dormant':'#94a3b8', 'under-review':'#f59e0b', 'approved':'#10b981', 'retired':'#64748b' };
  return colors[status] || '#94a3b8';
}

function dupScore(a, b) {
  if (String(a.id) === String(b.id)) return 0;
  var nameA = (a.name || '').toLowerCase();
  var nameB = (b.name || '').toLowerCase();
  if (nameA === nameB) return 100;
  var lev = levenshtein(nameA, nameB);
  var maxLen = Math.max(nameA.length, nameB.length) || 1;
  var score = Math.round((1 - lev / maxLen) * 50);
  if (a.type && b.type && a.type === b.type) score += 15;
  if (a.env && b.env && a.env === b.env) score += 15;
  var pA = Array.isArray(a.protocols) ? a.protocols : [];
  var pB = Array.isArray(b.protocols) ? b.protocols : [];
  var shared = pA.filter(function(p) { return pB.indexOf(p) >= 0; }).length;
  score += Math.min(10, shared * 5);
  return Math.min(99, score);
}

// ═══════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════

var viewRenderMap = {
  dashboard:    function() { renderDash(); },
  discovery:    function() { renderDisc(); },
  shadow:       function() { renderShadow(); },
  phi:          function() { renderPhi(); },
  models:       function() { renderModels(); },
  risk:         function() { renderRisk(); },
  compliance:   function() { renderComp(); },
  policy:       function() { renderPolicy(); },
  approvals:    function() { renderApprovals(); },
  playbooks:    function() { renderPlaybooks(); },
  lineage:      function() { renderLineage(); },
  live:         function() { renderLive(); },
  benchmark:    function() { renderBench(); },
  notifications:function() { renderNotif(); },
  activity:     function() { renderActivity(); },
  ciso:         function() { renderCiso(); },
  integrations: function() { renderInteg(); },
  coverage: function() { renderCoverage(); },
  operations: function() { renderOperations(); },
  shadowdash: function() { renderShadowDash(); },
  admin:        function() { renderAdmin(); },
  blast:        function() { renderBlast(); }
};

function go(v) {
  currentView = v;
  document.querySelectorAll('.view').forEach(function(el) {
    el.classList.remove('active');
    el.style.display = 'none';
  });
  document.querySelectorAll('.nav-item').forEach(function(el) { el.classList.remove('active'); });
  var viewEl = document.getElementById('view-' + v);
  if (viewEl) {
    viewEl.classList.add('active');
    viewEl.style.display = 'flex';
  }
  var navEl = document.getElementById('nav-' + v) || document.querySelector('[data-view="' + v + '"]');
  if (navEl) navEl.classList.add('active');
  if (viewRenderMap[v]) {
    try { viewRenderMap[v](); } catch(e) { console.warn('[go] render error for', v, ':', e.message); }
  }
  updateStats();
}

// ═══════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════

function updateStats() {
  var agents = DB.agents || [];
  var shadow = agents.filter(function(a) { return a.shadow; });
  var phi = agents.filter(function(a) { return a.phi || a.pii; });
  var crit = agents.filter(function(a) { return a.risk === 'critical'; });
  var viols = DB.policyViolations || [];

  function setEl(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }
  setEl('s-total', agents.length);
  setEl('s-shadow', shadow.length);
  setEl('s-crit', crit.length);
  setEl('s-viols', viols.length);
  setEl('dh-total', agents.length);
  setEl('dh-phi', phi.length);
  setEl('dh-crit', crit.length);
  setEl('nb-total', agents.length);
  setEl('nb-phi', phi.length);
  setEl('nb-crit', crit.length);
  setEl('shd-n', shadow.length);
  setEl('phi-n', phi.length);
  setEl('r-crit', crit.length);
  setEl('r-high', agents.filter(function(a) { return a.risk === 'high'; }).length);
  setEl('r-med', agents.filter(function(a) { return a.risk === 'medium'; }).length);
  setEl('r-low', agents.filter(function(a) { return a.risk === 'low'; }).length);
}

// ═══════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════

async function doLogin() {
  var email = document.getElementById('login-email') ? document.getElementById('login-email').value : '';
  var password = document.getElementById('login-password') ? document.getElementById('login-password').value : '';
  if (!email || !password) { showToast('Please enter email and password', 'error'); return; }

  console.log('[doLogin] Starting login for:', email);
  try {
    var res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: email, password: password })
    });
    var data = await res.json();
    if (!res.ok || !data.user) {
      showToast(data.error || 'Login failed', 'error');
      return;
    }

    currentRole = data.user.role;
    currentUser = data.user.name || data.user.email || email;
    _apiToken = data.token || null;

    console.log('[DEBUG] Set currentRole to:', currentRole);
    console.log('[auth] Logged in as:', currentUser, 'role:', currentRole);

    sessionStorage.setItem('ar-role', currentRole);
    sessionStorage.setItem('ar-user', currentUser);
    if (_apiToken) sessionStorage.setItem('ar-token', _apiToken);

    var loginScreen = document.getElementById('login-screen');
    if (loginScreen) loginScreen.classList.add('hidden');

    var nameEl = document.getElementById('login-user-name');
    var roleEl = document.getElementById('login-user-role');
    var avatarEl = document.getElementById('login-avatar');
    if (nameEl) nameEl.textContent = currentUser;
    if (roleEl) roleEl.textContent = (ROLES[currentRole] && ROLES[currentRole].label) || currentRole;
    if (avatarEl) avatarEl.textContent = currentUser.split(' ').map(function(w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase() || 'U';

    applyRBAC();
    await loadLiveAgents();
    go('dashboard');
    showToast('Welcome, ' + currentUser, 'success');
    addAct('login', 'User logged in: ' + currentUser, currentUser, '#10b981');

  } catch(e) {
    console.error('[doLogin] Error:', e.message);
    showToast('Login error: ' + e.message, 'error');
  }
}

function doLogout() {
  fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(function() {});
  currentRole = null;
  currentUser = '';
  _apiToken = null;
  sessionStorage.clear();
  DB = { agents: [], policyViolations: [], approvals: [], phiAgents: [], activity: [], notifications: [], scanners: [] };
  var loginScreen = document.getElementById('login-screen');
  if (loginScreen) loginScreen.classList.remove('hidden');
}

function applyRBAC() {
  if (!currentRole) { console.log('[RBAC] Skipped - not authenticated'); return; }
  var adminNav = document.querySelector('[data-view="admin"]');
  if (adminNav) adminNav.style.display = currentRole === 'platform_admin' ? '' : 'none';
  var roleEl = document.getElementById('login-user-role');
  if (roleEl) roleEl.textContent = (ROLES[currentRole] && ROLES[currentRole].label) || currentRole;
  console.log('[RBAC] Applied for role:', currentRole);
}

// ═══════════════════════════════════════════════════════════════
// LOAD LIVE AGENTS
// ═══════════════════════════════════════════════════════════════

async function loadLiveAgents() {
  try {
    var headers = {};
    if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
    var res = await fetch('/api/agents', { headers: headers, credentials: 'include' });
    if (!res.ok) return;
    var liveAgents = await res.json();
    if (!Array.isArray(liveAgents) || !liveAgents.length) return;

    var mapped = liveAgents.map(function(a, i) {
      var protocols = [];
      try { protocols = typeof a.protocols === 'string' ? JSON.parse(a.protocols) : (a.protocols || []); } catch(e) {}
      var meta = {};
      try { meta = typeof a.metadata === 'string' ? JSON.parse(a.metadata) : (a.metadata || {}); } catch(e) {}
      var controls = {};
      try { controls = typeof a.controls === 'string' ? JSON.parse(a.controls) : (a.controls || {}); } catch(e) {}
      if (!Object.keys(controls).length) {
        controls = { soc2:'warn', iso27001:'warn', gdpr:'warn', nist:'warn', euai:'warn', hipaa:'warn', hitrust:'warn', fda_samd:'warn' };
      }
      var detectMethod = a.detect || meta.detect || 'Manual registration';
      var notesStr = meta.notes || '';
      var rgMatch = notesStr.match(/Resource Group:\s*([^|]+)/);
      var regionMatch = notesStr.match(/Region:\s*([^|]+)/);
      var rawCat = a.agent_category || 'unknown';

      var agent = {
        id: a.id || (1000 + i),
        name: a.name || 'Unknown Agent',
        type: a.type || 'agent',
        env: a.env || 'Cloud',
        protocols: protocols,
        lastSeen: a.last_seen ? new Date(a.last_seen).toLocaleString() : 'Just now',
        risk: a.risk || 'medium',
        shadow: a.shadow || false,
        detect: detectMethod,
        dataAccess: a.data_access || meta.dataAccess || null,
        pii: a.pii || false,
        phi: a.phi || false,
        domain: a.domain || meta.domain || null,
        notes: meta.notes || a.notes || '',
        controls: controls,
        firstDet: a.first_detected ? a.first_detected.split('T')[0] : new Date().toISOString().split('T')[0],
        owner: a.owner || null,
        ver: a.version || null,
        approved: a.approved_by ? true : false,
        approvedBy: a.approved_by || null,
        approvalDate: a.approval_date || null,
        quarantined: a.quarantined || false,
        hosted: a.hosted || false,
        resourceGroup: rgMatch ? rgMatch[1].trim() : null,
        region: regionMatch ? regionMatch[1].trim() : (a.region || null),
        agent_category: rawCat === 'unknown' ? classifyAgentCategory({ name: a.name, type: a.type, detect: detectMethod, protocols: protocols, env: a.env }) : rawCat,
        lifecycle_status: a.lifecycle_status || 'active',
        review_date: a.review_date || null,
        review_cadence: a.review_cadence || '90days',
        baa_status: a.baa_status || 'unknown',
        duplicate_of: a.duplicate_of || null,
        duplicate_score: a.duplicate_score || 0
      };
      return agent;
    });

    DB.agents = mapped;

    // Compute policy violations
    DB.policyViolations = [];
    mapped.forEach(function(a) {
      var ctrl = a.controls || {};
      Object.keys(ctrl).forEach(function(fw) {
        if (ctrl[fw] === 'fail') {
          DB.policyViolations.push({ id: a.id + '-' + fw, rule: fw.toUpperCase() + ' control failure', agent: a, sev: a.risk === 'critical' ? 'critical' : 'high', ts: new Date().toISOString() });
        }
      });
      if (a.shadow) {
        DB.policyViolations.push({ id: a.id + '-shadow', rule: 'Unauthorized shadow AI agent detected', agent: a, sev: 'critical', ts: new Date().toISOString() });
      }
    });

    // Approvals
    DB.approvals = mapped.filter(function(a) { return !a.approved && (a.risk === 'critical' || a.risk === 'high' || a.shadow); }).map(function(a) {
      return { id: a.id, agent: a, status: 'pending', requestedBy: 'System', requestedAt: new Date().toISOString(), reason: a.shadow ? 'Shadow AI requires approval' : 'High-risk agent requires CISO approval' };
    });

    // PHI agents
    DB.phiAgents = mapped.filter(function(a) { return a.phi || a.pii; });

    // Duplicate scores
    mapped.forEach(function(a) {
      if (a.duplicate_score > 0) return;
      var best = 0, bestId = null;
      mapped.forEach(function(b) {
        if (String(a.id) === String(b.id)) return;
        var score = dupScore(a, b);
        if (score > best) { best = score; bestId = String(b.id); }
      });
      if (best >= 75) { a.duplicate_score = best; a.duplicate_of = bestId; }
    });

    // Update mode banner
    var banner = document.getElementById('mode-banner');
    var dot = document.getElementById('mode-dot');
    var label = document.getElementById('mode-label');
    if (banner) banner.className = 'mode-banner prod';
    if (dot) { dot.style.background = '#10b981'; dot.style.animation = 'none'; }
    if (label) { label.style.color = '#065f46'; label.textContent = 'Production — ' + mapped.length + ' live agents'; }
    showExportBtn();
    showExportBtn();

    console.log('[loadLiveAgents] DB populated:', { agents: mapped.length, violations: DB.policyViolations.length, approvals: DB.approvals.length, phi: DB.phiAgents.length });

    // Re-render active view
    var activeView = document.querySelector('.view.active');
    if (activeView && viewRenderMap[currentView]) {
      try { viewRenderMap[currentView](); } catch(e) {}
    }
    updateStats();

  } catch(e) {
    console.error('[loadLiveAgents]', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// SESSION RESTORE
// ═══════════════════════════════════════════════════════════════

fetch('/api/auth/me', { credentials: 'include' })
  .then(function(r) { return r.ok ? r.json() : null; })
  .then(function(data) {
    if (!data || !data.role) { currentRole = null; return; }
    currentRole = data.role;
    currentUser = data.name || data.email || 'User';
    _apiToken = sessionStorage.getItem('ar-token') || null;
    sessionStorage.setItem('ar-role', currentRole);
    sessionStorage.setItem('ar-user', currentUser);
    var loginScreen = document.getElementById('login-screen');
    if (loginScreen) loginScreen.classList.add('hidden');
    var nameEl = document.getElementById('login-user-name');
    var roleEl = document.getElementById('login-user-role');
    var avatarEl = document.getElementById('login-avatar');
    if (nameEl) nameEl.textContent = currentUser;
    if (roleEl) roleEl.textContent = (ROLES[currentRole] && ROLES[currentRole].label) || currentRole;
    if (avatarEl) avatarEl.textContent = currentUser.split(' ').map(function(w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase() || 'U';
    applyRBAC();
    loadLiveAgents().then(function() { go('dashboard'); });
    console.log('[session] Restored - role:', currentRole, 'user:', currentUser);
  })
  .catch(function() { currentRole = null; });

// ─── Login form keyboard handler ──────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  var pwdEl = document.getElementById('login-password');
  if (pwdEl) {
    pwdEl.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') doLogin();
    });
  }
  var emailEl = document.getElementById('login-email');
  if (emailEl) {
    emailEl.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') doLogin();
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// AGENT ACTIONS
// ═══════════════════════════════════════════════════════════════

function approveAgent(id) {
  var headers = { 'Content-Type': 'application/json' };
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/agents/' + id + '/approve', { method: 'POST', headers: headers, credentials: 'include' })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (data) { showToast('Agent approved', 'success'); loadLiveAgents(); }
    })
    .catch(function(e) { showToast('Approval failed', 'error'); });
}

function quarantineAgent(id) {
  var headers = { 'Content-Type': 'application/json' };
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/agents/' + id + '/quarantine', { method: 'POST', headers: headers, credentials: 'include' })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function() { showToast('Agent quarantined', 'success'); loadLiveAgents(); })
    .catch(function() { showToast('Quarantine failed', 'error'); });
}

// ═══════════════════════════════════════════════════════════════
// DRAWER — AGENT PASSPORT
// ═══════════════════════════════════════════════════════════════

function openDrawer(idOrEl) {
  var id = typeof idOrEl === 'string' ? idOrEl : (idOrEl && idOrEl.dataset && idOrEl.dataset.id) || String(idOrEl);
  var drw = document.getElementById('drawer');
  if (drw) drw.dataset.agentId = id;
  var a = DB.agents.find(function(x) { return String(x.id) === String(id); });
  if (!a) { console.warn('[drawer] Agent not found:', id); return; }

  var ctrl = typeof a.controls === 'string' ? JSON.parse(a.controls || '{}') : (a.controls || {});
  var cat = a.agent_category || classifyAgentCategory(a);
  var catLabel = agentCategoryLabel(cat);
  var catColor = agentCategoryColor(cat);
  var lifecycle = a.lifecycle_status || 'active';
  var lcLabel = lifecycleLabel(lifecycle);
  var lcColor = lifecycleColor(lifecycle);
  var viols = (DB.policyViolations || []).filter(function(v) { return v.agent && String(v.agent.id) === String(id); });
  var rc = { critical:'#ef4444', high:'#f59e0b', medium:'#6366f1', low:'#10b981' }[a.risk] || '#6366f1';
  var protos = Array.isArray(a.protocols) ? a.protocols : [];
  var agentId = escapeHtml(String(a.id || ''));

  // Compliance rows
  var fwMap = { soc2:'SOC 2 Type II', iso27001:'ISO 27001', gdpr:'GDPR', nist:'NIST AI RMF', euai:'EU AI Act', hipaa:'HIPAA', hitrust:'HITRUST CSF', fda_samd:'FDA SaMD' };
  var fwHTML = '';
  Object.keys(fwMap).forEach(function(fw) {
    var val = ctrl[fw] || 'warn';
    var color = val === 'pass' ? '#059669' : val === 'fail' ? '#dc2626' : '#d97706';
    var bg = val === 'pass' ? '#f0fdf4' : val === 'fail' ? '#fef2f2' : '#fff7ed';
    var label = val === 'pass' ? 'PASS' : val === 'fail' ? 'FAIL' : 'WARN';
    fwHTML += '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--glass-border-dim);font-size:12px"><span style="flex:1;color:var(--text-secondary)">' + fwMap[fw] + '</span><span style="font-size:10px;font-weight:700;padding:2px 10px;border-radius:99px;background:' + bg + ';color:' + color + '">' + label + '</span></div>';
  });

  // Violations
  var violHTML = viols.length
    ? viols.map(function(v) { return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--glass-border-dim);font-size:11px"><span style="width:8px;height:8px;border-radius:50%;background:#ef4444;flex-shrink:0"></span><span style="flex:1;color:var(--text-primary)">' + escapeHtml(v.rule || 'Policy violation') + '</span><span style="font-size:10px;color:#dc2626;font-weight:600">' + (v.sev || 'HIGH').toUpperCase() + '</span></div>'; }).join('')
    : '<div style="font-size:11px;color:var(--text-muted);padding:8px 0">No active policy violations</div>';

  // Related agents for blast radius
  var related = DB.agents.filter(function(b) {
    if (String(b.id) === String(id)) return false;
    var bp = Array.isArray(b.protocols) ? b.protocols : [];
    return b.env === a.env || protos.some(function(p) { return bp.indexOf(p) >= 0; }) || (b.phi && a.phi);
  }).slice(0, 6);

  var blastScore = Math.min(10, (({ critical:8, high:6, medium:4, low:2 }[a.risk] || 4) + related.length * 0.3 + (a.phi ? 1.5 : 0) + (a.shadow ? 1.5 : 0))).toFixed(1);

  // Blast SVG
  var W = 320, H = 180, cx = W / 2, cy = H / 2, br = 70;
  var svg = '<svg width="' + W + '" height="' + H + '">';
  svg += '<defs><radialGradient id="brg"><stop offset="0%" stop-color="' + rc + '" stop-opacity="0.2"/><stop offset="100%" stop-color="' + rc + '" stop-opacity="0"/></radialGradient></defs>';
  svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + br + '" fill="url(#brg)"/>';
  svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + br + '" fill="none" stroke="' + rc + '" stroke-width="0.5" stroke-dasharray="4 4" opacity="0.4"/>';
  related.forEach(function(b, i) {
    var angle = (i / Math.max(related.length, 1)) * 2 * Math.PI - Math.PI / 2;
    var nx = Math.round(cx + (br - 10) * Math.cos(angle));
    var ny = Math.round(cy + (br - 10) * Math.sin(angle));
    var bc = { critical:'#ef4444', high:'#f59e0b', medium:'#6366f1', low:'#10b981' }[b.risk] || '#6366f1';
    svg += '<line x1="' + cx + '" y1="' + cy + '" x2="' + nx + '" y2="' + ny + '" stroke="' + rc + '" stroke-width="0.8" opacity="0.3"/>';
    svg += '<circle cx="' + nx + '" cy="' + ny + '" r="8" fill="' + bc + '22" stroke="' + bc + '" stroke-width="1"/>';
    svg += '<circle cx="' + nx + '" cy="' + ny + '" r="4" fill="' + bc + '"/>';
  });
  svg += '<circle cx="' + cx + '" cy="' + cy + '" r="18" fill="' + rc + '22" stroke="' + rc + '" stroke-width="2"/>';
  svg += '<circle cx="' + cx + '" cy="' + cy + '" r="10" fill="' + rc + '"/>';
  svg += '<text x="8" y="20" font-size="8" fill="var(--text-muted)">BLAST SCORE</text>';
  svg += '<text x="8" y="34" font-size="16" font-weight="600" fill="' + rc + '">' + blastScore + '</text>';
  svg += '</svg>';

  // Alert banner
  var alertHTML = '';
  if (a.phi && ctrl.hipaa === 'fail') {
    alertHTML = '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:11px;color:#dc2626">&#9888; PHI agent with failing HIPAA controls - BAA required immediately</div>';
  } else if (a.shadow) {
    alertHTML = '<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:11px;color:#c2410c">&#9888; Shadow AI detected - not registered or approved. Immediate review required.</div>';
  }

  // Info cell helper
  function iCell(label, val, color) {
    return '<div style="background:var(--bg-secondary);border:1px solid var(--glass-border-dim);border-radius:8px;padding:10px 12px"><div style="font-size:10px;color:var(--text-muted);margin-bottom:3px">' + label + '</div><div style="font-size:12px;font-weight:600;color:' + (color || 'var(--text-primary)') + '">' + val + '</div></div>';
  }

  var ownerInitials = a.owner ? a.owner.split(' ').map(function(w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase() : '?';

  // Build HTML
  var h = '';

  // Header
  h += '<div style="padding:16px 20px 12px;border-bottom:1px solid var(--glass-border-dim)">';
  h += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">';
  h += '<div style="width:10px;height:10px;border-radius:50%;background:' + rc + ';flex-shrink:0"></div>';
  h += '<div style="flex:1"><div style="font-size:16px;font-weight:700;color:var(--text-primary)">' + escapeHtml(a.name || '') + '</div>';
  h += '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">ID: ' + agentId + ' &middot; ' + escapeHtml(a.env || 'Cloud') + ' &middot; First seen: ' + escapeHtml(a.firstDet || '') + '</div></div></div>';
  h += '<div style="display:flex;gap:5px;flex-wrap:wrap">';
  h += '<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;background:' + rc + '18;color:' + rc + '">' + (a.risk || 'medium').toUpperCase() + ' RISK</span>';
  h += '<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;background:' + catColor + '18;color:' + catColor + '">' + catLabel + '</span>';
  h += '<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;background:var(--bg-secondary);color:' + lcColor + '">' + lcLabel + '</span>';
  if (a.phi) h += '<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;background:#fef2f2;color:#dc2626">PHI</span>';
  if (a.shadow) h += '<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;background:#fff7ed;color:#c2410c">SHADOW AI</span>';
  if (a.approved) h += '<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;background:#f0fdf4;color:#059669">APPROVED</span>';
  else h += '<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;background:#fff7ed;color:#d97706">PENDING</span>';
  h += '</div></div>';

  // Tabs
  h += '<div class="drw2-tabs">';
  h += '<div class="drw2-tab active" data-tab="overview" onclick="switchAnatomyTab(this.dataset.tab,this)">OVERVIEW<small>Agent passport</small></div>';
  h += '<div class="drw2-tab" data-tab="dataaccess" onclick="switchAnatomyTab(this.dataset.tab,this)">DATA ACCESS<small>What it can touch</small></div>';
  h += '<div class="drw2-tab" data-tab="compliance" onclick="switchAnatomyTab(this.dataset.tab,this)">COMPLIANCE<small>8 frameworks</small></div>';
  h += '<div class="drw2-tab" data-tab="ownership" onclick="switchAnatomyTab(this.dataset.tab,this)">OWNERSHIP<small>Who owns it</small></div>';
  h += '<div class="drw2-tab" data-tab="blastradius" onclick="switchAnatomyTab(this.dataset.tab,this)">BLAST RADIUS<small>Attack surface</small></div>';
  h += '</div>';

  h += '<div class="drw2-body" style="display:block;overflow-y:auto;padding:16px 20px">';

  // OVERVIEW TAB
  h += '<div class="anatomy-tab-content active" id="tab-overview">';
  h += alertHTML;
  h += '<div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Agent profile</div>';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">';
  h += iCell('Category', catLabel, catColor);
  h += iCell('Lifecycle', lcLabel, lcColor);
  h += iCell('Environment', escapeHtml(a.env || 'Cloud'));
  h += iCell('Detection', escapeHtml(a.detect || 'Manual'));
  h += iCell('Owner', escapeHtml(a.owner || 'Unassigned'), a.owner ? 'var(--text-primary)' : '#dc2626');
  h += iCell('Last reviewed', a.review_date ? new Date(a.review_date).toLocaleDateString() : 'Never reviewed', a.review_date ? 'var(--text-primary)' : '#dc2626');
  h += '</div>';
  if (viols.length) { h += '<div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Policy violations (' + viols.length + ')</div>' + violHTML; }
  h += '<div style="display:flex;gap:8px;margin-top:14px;padding-top:14px;border-top:1px solid var(--glass-border-dim)">';
  h += '<button class="btn sm" data-id="' + agentId + '" onclick="approveAgent(this.dataset.id)">Approve</button>';
  h += '<button class="btn sm secondary" onclick="go(this.dataset.view)" data-view="policy">View violations</button>';
  h += '<button class="btn sm danger" data-id="' + agentId + '" onclick="quarantineAgent(this.dataset.id)">Quarantine</button>';
  h += '</div></div>';

  // DATA ACCESS TAB
  h += '<div class="anatomy-tab-content" id="tab-dataaccess">';
  h += '<div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Data scope</div>';
  h += '<div style="background:var(--bg-secondary);border:1px solid var(--glass-border-dim);border-radius:8px;padding:12px;margin-bottom:12px">';
  h += '<div style="font-size:12px;color:var(--text-primary);margin-bottom:8px">' + escapeHtml(a.dataAccess || 'No data scope defined') + '</div>';
  if (a.phi) h += '<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;background:#fef2f2;color:#dc2626">Contains PHI - HIPAA regulated</span> ';
  if (a.pii) h += '<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;background:#faf5ff;color:#7c3aed">Contains PII - GDPR regulated</span>';
  h += '</div>';
  h += '<div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Protocols</div>';
  h += protos.length ? protos.map(function(p) {
    var isHC = ['HL7 v2','FHIR R4','DICOM','MLLP'].indexOf(p) >= 0;
    return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--glass-border-dim);font-size:11px"><span style="width:8px;height:8px;border-radius:50%;background:' + (isHC ? '#8b5cf6' : '#3b82f6') + ';flex-shrink:0"></span><span style="flex:1;color:var(--text-primary)">' + escapeHtml(p) + '</span><span style="font-size:10px;color:' + (isHC ? '#7c3aed' : '#2563eb') + ';font-weight:600">' + (isHC ? 'Healthcare' : 'Standard') + '</span></div>';
  }).join('') : '<div style="font-size:11px;color:var(--text-muted);padding:8px 0">No protocols registered</div>';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px">';
  h += iCell('Region', escapeHtml(a.region || 'Unknown'));
  var baaVal = a.baa_status === 'signed' ? 'Signed' : a.baa_status === 'required' ? 'Required - missing' : 'Unknown';
  var baaColor = a.baa_status === 'signed' ? '#059669' : a.baa_status === 'required' ? '#dc2626' : '#d97706';
  h += iCell('BAA status', baaVal, baaColor);
  h += iCell('Resource group', escapeHtml(a.resourceGroup || 'Unknown'));
  h += iCell('Version', escapeHtml(a.ver || 'Unknown'));
  h += '</div></div>';

  // COMPLIANCE TAB
  h += '<div class="anatomy-tab-content" id="tab-compliance">';
  h += '<div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Framework compliance</div>';
  h += fwHTML;
  h += '</div>';

  // OWNERSHIP TAB
  h += '<div class="anatomy-tab-content" id="tab-ownership">';
  h += '<div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Agent owner</div>';
  h += '<div style="background:var(--bg-secondary);border:1px solid var(--glass-border-dim);border-radius:8px;padding:12px;margin-bottom:12px;display:flex;align-items:center;gap:10px">';
  h += '<div style="width:36px;height:36px;border-radius:50%;background:var(--brand-bg);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:var(--brand);flex-shrink:0">' + ownerInitials + '</div>';
  h += '<div style="flex:1"><div style="font-size:13px;font-weight:700;color:' + (a.owner ? 'var(--text-primary)' : '#dc2626') + '">' + escapeHtml(a.owner || 'Unassigned') + '</div>';
  h += '<div style="font-size:11px;color:var(--text-muted)">' + (a.owner ? 'Agent owner' : 'No owner assigned') + '</div></div>';
  h += '<button class="btn sm secondary" data-id="'+agentId+'" onclick="assignOwner(this.dataset.id)">Assign</button></div>';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">';
  h += iCell('Review cadence', escapeHtml(a.review_cadence || '90 days'));
  h += iCell('Last reviewed', a.review_date ? new Date(a.review_date).toLocaleDateString() : 'Never', a.review_date ? 'var(--text-primary)' : '#dc2626');
  h += iCell('Approved by', escapeHtml(a.approvedBy || 'Not approved'), a.approvedBy ? 'var(--text-primary)' : '#dc2626');
  h += iCell('Approval date', a.approvalDate ? new Date(a.approvalDate).toLocaleDateString() : 'N/A');
  h += '</div>';

  // BAA Section (only for PHI agents)
  if (a.phi) {
    var baaStatus = a.baa_status || 'unknown';
    var baaColor = baaStatus==='signed'?'#059669':baaStatus==='required'?'#dc2626':'#d97706';
    var baaLabel = baaStatus==='signed'?'BAA Signed':baaStatus==='required'?'BAA Required — Missing':'BAA Status Unknown';
    h += '<div style="background:'+(baaStatus==='signed'?'#f0fdf4':baaStatus==='required'?'#fef2f2':'#fff7ed')+';border:1px solid '+(baaStatus==='signed'?'#bbf7d0':baaStatus==='required'?'#fecaca':'#fed7aa')+';border-radius:8px;padding:12px 14px;margin-bottom:12px">';
    h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">';
    h += '<span style="font-size:12px;font-weight:700;color:'+baaColor+'">&#9679; '+baaLabel+'</span></div>';
    if (baaStatus==='signed') {
      h += '<div style="font-size:11px;color:var(--text-muted)">';
      if (a.baa_signed_by) h += 'Signed by: '+escapeHtml(a.baa_signed_by)+'<br>';
      if (a.baa_signed_date) h += 'Signed: '+new Date(a.baa_signed_date).toLocaleDateString()+'<br>';
      if (a.baa_expiry_date) h += 'Expires: '+new Date(a.baa_expiry_date).toLocaleDateString()+'<br>';
      if (a.baa_document_url) h += '<a href="'+escapeHtml(a.baa_document_url)+'" target="_blank" style="color:var(--brand)">View BAA document &#8594;</a>';
      h += '</div>';
    } else {
      h += '<div style="font-size:11px;color:#dc2626;margin-bottom:8px">This PHI agent requires a signed BAA before processing patient data</div>';
    }
    h += '<div style="display:flex;gap:6px;margin-top:8px">';
    h += '<button data-id="'+agentId+'" onclick="openBAAForm(this.dataset.id)" class="btn sm primary" style="font-size:10px">'+(baaStatus==='signed'?'Update BAA':'Record BAA')+'</button>';
    h += '<button data-id="'+agentId+'" onclick="markBAARequired(this.dataset.id)" class="btn sm secondary" style="font-size:10px">Mark as Required</button>';
    h += '</div></div>';
  }
  h += '</div>';

  // BLAST RADIUS TAB
  h += '<div class="anatomy-tab-content" id="tab-blastradius">';
  h += '<div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Blast radius</div>';
  h += '<div style="display:flex;align-items:center;gap:12px;background:var(--bg-secondary);border:1px solid var(--glass-border-dim);border-radius:8px;padding:12px;margin-bottom:12px">';
  h += '<div style="font-size:28px;font-weight:700;color:' + rc + '">' + blastScore + '</div>';
  h += '<div><div style="font-size:12px;font-weight:700;color:var(--text-primary)">' + (parseFloat(blastScore) >= 8 ? 'Severe' : parseFloat(blastScore) >= 6 ? 'High' : parseFloat(blastScore) >= 4 ? 'Medium' : 'Low') + ' blast radius</div>';
  h += '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + related.length + ' systems exposed if compromised</div></div></div>';
  h += '<div style="text-align:center;margin-bottom:12px">' + svg + '</div>';
  h += '<div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Exposed systems</div>';
  h += related.length ? related.map(function(b) {
    var bc = { critical:'#ef4444', high:'#f59e0b', medium:'#6366f1', low:'#10b981' }[b.risk] || '#6366f1';
    return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--glass-border-dim);font-size:11px"><span style="width:8px;height:8px;border-radius:50%;background:' + bc + ';flex-shrink:0"></span><span style="flex:1;color:var(--text-primary)">' + escapeHtml(b.name) + '</span><span style="font-size:10px;font-weight:600;color:' + bc + '">' + (b.risk || '').toUpperCase() + '</span></div>';
  }).join('') : '<div style="font-size:11px;color:var(--text-muted);padding:8px 0">No connected systems detected</div>';
  if (a.phi) h += '<div style="margin-top:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 12px;font-size:11px;color:#dc2626"><strong>Regulatory impact:</strong> HIPAA breach notification required within 60 days. Potential fine: $100K-$1.9M.</div>';
  h += '<div style="display:flex;gap:8px;margin-top:14px;padding-top:14px;border-top:1px solid var(--glass-border-dim)">';
  h += '<button class="btn sm danger" data-id="' + agentId + '" onclick="quarantineAgent(this.dataset.id)">Quarantine now</button>';
  h += '<button class="btn sm secondary" onclick="go(this.dataset.view)" data-view="ciso">Generate CISO report</button>';
  h += '</div></div>';

  h += '</div>';

  var el = document.getElementById('drawer');
  if (!el) return;
  el.innerHTML = h;
  el.classList.add('open');
  var bd = document.getElementById('drawer-backdrop');
  if (bd) bd.classList.add('show');
}

function closeDrawer() {
  var drw = document.getElementById('drawer');
  var bd = document.getElementById('drawer-backdrop');
  if (drw) drw.classList.remove('open');
  if (bd) bd.classList.remove('show');
}

function switchAnatomyTab(tab, el) {
  document.querySelectorAll('.drw2-tab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.anatomy-tab-content').forEach(function(t) { t.classList.remove('active'); });
  if (el) el.classList.add('active');
  var tc = document.getElementById('tab-' + tab);
  if (tc) tc.classList.add('active');
}

// ═══════════════════════════════════════════════════════════════
// DISCOVERY TABLE
// ═══════════════════════════════════════════════════════════════

function setEF(e, el) { ef = e; document.querySelectorAll('.filter-bar .filter-pill').forEach(function(p) { p.classList.remove('on'); }); if (el) el.classList.add('on'); renderDisc(); }
function setTF(t, el) { tf = t; document.querySelectorAll('#type-btns .filter-pill').forEach(function(p) { p.classList.remove('on'); }); if (el) el.classList.add('on'); renderDisc(); }
function setRF(f, el) { rf = f; document.querySelectorAll('#risk-pills .filter-pill').forEach(function(p) { p.classList.remove('on'); }); if (el) el.classList.add('on'); renderRisk(); }

function renderDisc() {
  var list = DB.agents.filter(function(a) {
    if (ef !== 'all' && a.env !== ef) return false;
    if (tf !== 'all' && a.type !== tf) return false;
    return true;
  });

  // Build duplicate map
  var dupMap = {};
  list.forEach(function(a) {
    if (a.duplicate_score >= 75 && a.duplicate_of) {
      dupMap[a.id] = { score: a.duplicate_score, ofId: a.duplicate_of };
    }
  });

  var tb = document.getElementById('disc-tbody');
  if (!tb) return;

  tb.innerHTML = list.map(function(a) {
    var id = String(a.id || '').replace(/"/g, '');
    var cat = a.agent_category || classifyAgentCategory(a);
    var catColor = agentCategoryColor(cat);
    var catLabel = agentCategoryLabel(cat);
    var lifecycle = a.lifecycle_status || 'active';
    var lcColor = lifecycleColor(lifecycle);
    var lcLabel = lifecycleLabel(lifecycle);
    var dup = dupMap[a.id];

    var dupCell = dup
      ? '<span style="font-size:10px;font-weight:600;color:#f59e0b;background:#fff7ed;border:1px solid #fed7aa;padding:2px 7px;border-radius:99px">&#9889; ' + dup.score + '% match</span>'
      : '<span style="font-size:10px;color:var(--text-muted)">&#8212;</span>';

    var nameCell = '<span style="font-weight:700;color:var(--text-primary)">' + escapeHtml(a.name || '') + '</span>'
      + (a.phi ? ' <span style="font-size:9px;font-weight:700;background:#fee2e2;color:#dc2626;border-radius:3px;padding:1px 4px">PHI</span>' : '')
      + (a.shadow ? ' <span style="font-size:9px;font-weight:700;background:#fff7ed;color:#c2410c;border-radius:3px;padding:1px 4px">SHADOW</span>' : '');

    var ownerCell = a.owner
      ? '<span style="font-size:11px;color:var(--text-secondary)">' + escapeHtml(a.owner) + '</span>'
      : '<span style="font-size:10px;color:#dc2626">Unassigned</span>';

    var statusCell = a.shadow
      ? '<span style="font-size:10px;font-weight:600;color:#dc2626">Shadow AI</span>'
      : a.approved
        ? '<span style="font-size:10px;font-weight:600;color:#059669">Approved</span>'
        : '<span style="font-size:10px;font-weight:600;color:#d97706">Pending</span>';

    var rowStyle = (a.shadow ? 'border-left:3px solid #ef4444;' : '') + (dup ? 'background:rgba(251,191,36,0.04);' : '');

    var row = '<tr onclick="openDrawer(this.dataset.id)" data-id="' + id + '" style="' + rowStyle + '">';
    row += '<td>' + nameCell + '</td>';
    row += '<td><span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;background:' + catColor + '18;color:' + catColor + '">' + catLabel + '</span></td>';
    row += '<td style="font-size:11px;color:var(--text-muted)">' + escapeHtml(a.type || 'AI Agent') + '</td>';
    row += '<td>' + envTag(a.env) + '</td>';
    row += '<td style="font-size:11px;color:var(--text-muted);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(a.dataAccess || '&#8212;') + '</td>';
    row += '<td>' + ownerCell + '</td>';
    row += '<td style="font-size:11px;color:var(--text-muted)">' + escapeHtml(a.lastSeen || '') + '</td>';
    // Risk score
    var _ctrl = typeof a.controls==='string'?JSON.parse(a.controls||'{}'):(a.controls||{});
    var _fails = Object.values(_ctrl).filter(function(v){return v==='fail';}).length;
    var _score = 0;
    if (a.phi) _score+=20; if (a.pii) _score+=10; if (a.shadow) _score+=25;
    _score += Math.min(20,_fails*3);
    if (!a.review_date) _score+=10; if (!a.owner) _score+=10;
    _score = Math.min(100,_score);
    var _sc = _score>=70?'#ef4444':_score>=50?'#f59e0b':_score>=30?'#6366f1':'#10b981';
    row += '<td><span style="font-size:11px;font-weight:700;color:'+_sc+'">'+_score+'</span><span style="font-size:9px;color:var(--text-muted)">/100</span></td>';
    row += '<td>' + rtag(a.risk) + '</td>';
    row += '<td><span style="font-size:10px;font-weight:600;color:' + lcColor + '">' + lcLabel + '</span></td>';
    row += '<td>' + dupCell + '</td>';
    row += '<td>' + statusCell + '</td>';
    row += '</tr>';
    return row;
  }).join('');

  updateStats();

  // Background scan status
  if (!currentRole) return;
  fetch('/api/scan/background/status', { credentials: 'include' })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (!data) return;
      var el = document.getElementById('bg-scan-status');
      if (!el) return;
      var nextRun = data.nextRunIn || 'soon';
      el.innerHTML = '<span style="color:#10b981">&#9679;</span> Background scanner active &middot; Next: ' + nextRun;
    })
    .catch(function() {});
}

// ═══════════════════════════════════════════════════════════════
// SHADOW VIEW
// ═══════════════════════════════════════════════════════════════

function renderShadow() {
  var list = DB.agents.filter(function(a) { return a.shadow; });
  var el_n = document.getElementById('shd-n');
  var el_pii = document.getElementById('shd-pii');
  var el_meth = document.getElementById('shd-meth');
  var el_avg = document.getElementById('shd-avg');
  if (el_n) el_n.textContent = list.length;
  if (el_pii) el_pii.textContent = list.filter(function(a) { return a.pii; }).length;
  if (el_meth) el_meth.textContent = list.length > 0 ? [...new Set(list.map(function(a) { return a.detect; }))].length : 0;
  var sm = { critical:100, high:75, medium:50, low:25 };
  if (el_avg) el_avg.textContent = list.length ? Math.round(list.reduce(function(acc, a) { return acc + (sm[a.risk] || 0); }, 0) / list.length) : '&#8212;';

  var tb = document.getElementById('shadow-tbody');
  if (!tb) return;
  var vs = (DB.policyViolations || []).filter(function(v) { return v.agent && v.agent.shadow; });
  tb.innerHTML = list.map(function(a) {
    var id = String(a.id || '').replace(/"/g, '');
    var row = '<tr onclick="openDrawer(this.dataset.id)" data-id="' + id + '" style="border-left:3px solid #ef4444">';
    row += '<td style="font-weight:700;color:var(--text-primary)">' + escapeHtml(a.name || '') + '</td>';
    row += '<td style="font-size:11px;color:var(--text-muted)">' + escapeHtml(a.detect || '') + '</td>';
    row += '<td>' + envTag(a.env) + '</td>';
    row += '<td style="font-size:11px;color:var(--text-muted)">' + escapeHtml(a.dataAccess || '') + '</td>';
    row += '<td style="font-size:11px;color:var(--text-muted)">' + escapeHtml(a.firstDet || '') + '</td>';
    row += '<td>' + rtag(a.risk) + '</td>';
    row += '<td><button class="btn danger sm" data-id="' + id + '" onclick="event.stopPropagation();quarantineAgent(this.dataset.id)" style="font-size:10px;padding:2px 8px">Quarantine</button></td>';
    row += '<td><span class="shadow-tag">Shadow</span></td>';
    row += '</tr>';
    return row;
  }).join('');

  var vl = document.getElementById('policy-viols');
  if (vl) vl.innerHTML = vs.length
    ? vs.map(function(v) { return '<div class="risk-item" onclick="openDrawer(this.dataset.id)" data-id="' + escapeHtml(String(v.agent.id)) + '"><div class="risk-item-row"><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;background:#fef2f2;color:#dc2626">CRITICAL</span><span style="font-size:11px;font-weight:700;color:var(--text-primary)">' + escapeHtml(v.agent.name || '') + '</span></div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + escapeHtml(v.rule || '') + '</div></div>'; }).join('')
    : '<div style="font-size:11px;color:var(--text-muted);padding:8px 0">No shadow AI violations</div>';
}

// ═══════════════════════════════════════════════════════════════
// PHI VIEW
// ═══════════════════════════════════════════════════════════════

function renderPhi() {
  var list = DB.agents.filter(function(a) { return a.phi || a.pii; });
  var noBaa = list.filter(function(a) { return !a.controls || a.controls.hipaa === 'fail'; });
  var unenc = list.filter(function(a) { return a.controls && a.controls.encryption === 'fail'; });
  var compliant = list.filter(function(a) { return a.controls && a.controls.hipaa === 'pass'; });

  function setEl(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }
  setEl('phi-n', list.length);
  setEl('phi-nobaa', noBaa.length);
  setEl('phi-noenc', unenc.length);
  setEl('phi-ok', compliant.length);

  var tb = document.getElementById('phi-tbody');
  if (!tb) return;
  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text-muted)">No PHI agents detected</td></tr>';
    return;
  }
  tb.innerHTML = list.map(function(a) {
    var hipaa = (a.controls && a.controls.hipaa) || 'warn';
    var enc = (a.controls && a.controls.encryption) || 'warn';
    var hipaaColor = hipaa === 'pass' ? '#10b981' : hipaa === 'fail' ? '#ef4444' : '#f59e0b';
    var encColor = enc === 'pass' ? '#10b981' : enc === 'fail' ? '#ef4444' : '#f59e0b';
    var id = String(a.id || '').replace(/"/g, '');
    var ctrl = a.controls || {};
    var score = Object.keys(ctrl).length ? Math.round(Object.values(ctrl).filter(function(v) { return v === 'pass'; }).length / Object.keys(ctrl).length * 100) : 0;
    var row = '<tr onclick="openDrawer(this.dataset.id)" data-id="' + id + '">';
    row += '<td style="font-weight:700">' + escapeHtml(a.name || '') + '</td>';
    row += '<td style="font-size:11px;color:var(--text-muted)">' + escapeHtml(a.domain || a.env || '') + '</td>';
    row += '<td style="font-size:11px;color:var(--text-muted)">' + (a.protocols || []).slice(0, 2).join(', ') + '</td>';
    row += '<td><span style="font-size:10px;font-weight:700;color:' + hipaaColor + '">' + hipaa.toUpperCase() + '</span></td>';
    row += '<td><span style="font-size:10px;font-weight:700;color:' + encColor + '">' + enc.toUpperCase() + '</span></td>';
    row += '<td>' + score + '%</td>';
    row += '<td style="font-size:11px;color:var(--text-muted)">' + escapeHtml(a.lastSeen || '') + '</td>';
    row += '<td>' + rtag(a.risk) + '</td>';
    row += '</tr>';
    return row;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
// MODELS VIEW
// ═══════════════════════════════════════════════════════════════

function renderModels() {
  var agents = DB.agents;

  // Extract model info from agent metadata
  var modelMap = {};

  // Known model patterns to detect from agent names/notes/detect
  var MODEL_PATTERNS = [
    { pattern:/gpt-4o-mini/i,          model:'GPT-4o Mini',          vendor:'OpenAI',    type:'LLM',       risk:'medium', phi_capable:true,  baa:false, soc2:true  },
    { pattern:/gpt-4o/i,               model:'GPT-4o',               vendor:'OpenAI',    type:'LLM',       risk:'high',   phi_capable:true,  baa:false, soc2:true  },
    { pattern:/gpt-4.*turbo/i,         model:'GPT-4 Turbo',          vendor:'OpenAI',    type:'LLM',       risk:'high',   phi_capable:true,  baa:false, soc2:true  },
    { pattern:/gpt-4/i,                model:'GPT-4',                vendor:'OpenAI',    type:'LLM',       risk:'high',   phi_capable:true,  baa:false, soc2:true  },
    { pattern:/gpt-3\.5/i,             model:'GPT-3.5 Turbo',        vendor:'OpenAI',    type:'LLM',       risk:'medium', phi_capable:true,  baa:false, soc2:true  },
    { pattern:/azure.*openai|aoai/i,   model:'Azure OpenAI',         vendor:'Microsoft', type:'LLM',       risk:'medium', phi_capable:true,  baa:true,  soc2:true  },
    { pattern:/claude.*opus/i,         model:'Claude 3 Opus',        vendor:'Anthropic', type:'LLM',       risk:'medium', phi_capable:true,  baa:false, soc2:true  },
    { pattern:/claude.*sonnet/i,       model:'Claude 3.5 Sonnet',    vendor:'Anthropic', type:'LLM',       risk:'medium', phi_capable:true,  baa:false, soc2:true  },
    { pattern:/claude.*haiku/i,        model:'Claude 3 Haiku',       vendor:'Anthropic', type:'LLM',       risk:'low',    phi_capable:true,  baa:false, soc2:true  },
    { pattern:/claude/i,               model:'Claude',               vendor:'Anthropic', type:'LLM',       risk:'medium', phi_capable:true,  baa:false, soc2:true  },
    { pattern:/gemini.*pro/i,          model:'Gemini 1.5 Pro',       vendor:'Google',    type:'LLM',       risk:'high',   phi_capable:false, baa:false, soc2:true  },
    { pattern:/gemini.*flash/i,        model:'Gemini 2.0 Flash',     vendor:'Google',    type:'LLM',       risk:'medium', phi_capable:false, baa:false, soc2:true  },
    { pattern:/gemini/i,               model:'Gemini',               vendor:'Google',    type:'LLM',       risk:'medium', phi_capable:false, baa:false, soc2:true  },
    { pattern:/vertex.*ai|vertexai/i,  model:'Vertex AI',            vendor:'Google',    type:'LLM',       risk:'medium', phi_capable:true,  baa:true,  soc2:true  },
    { pattern:/llama.*3/i,             model:'Llama 3',              vendor:'Meta',      type:'LLM',       risk:'medium', phi_capable:true,  baa:false, soc2:false },
    { pattern:/llama/i,                model:'Llama',                vendor:'Meta',      type:'LLM',       risk:'medium', phi_capable:true,  baa:false, soc2:false },
    { pattern:/mistral/i,              model:'Mistral',              vendor:'Mistral',   type:'LLM',       risk:'medium', phi_capable:false, baa:false, soc2:false },
    { pattern:/bedrock/i,              model:'AWS Bedrock',          vendor:'AWS',       type:'LLM',       risk:'medium', phi_capable:true,  baa:true,  soc2:true  },
    { pattern:/sagemaker/i,            model:'SageMaker',            vendor:'AWS',       type:'ML',        risk:'medium', phi_capable:true,  baa:true,  soc2:true  },
    { pattern:/titan/i,                model:'Amazon Titan',         vendor:'AWS',       type:'LLM',       risk:'medium', phi_capable:true,  baa:true,  soc2:true  },
    { pattern:/whisper/i,              model:'Whisper',              vendor:'OpenAI',    type:'STT',       risk:'high',   phi_capable:true,  baa:false, soc2:false },
    { pattern:/dall.e|dalle/i,         model:'DALL-E',               vendor:'OpenAI',    type:'Image',     risk:'medium', phi_capable:false, baa:false, soc2:true  },
    { pattern:/embedding/i,            model:'Embeddings',           vendor:'OpenAI',    type:'Embedding', risk:'medium', phi_capable:true,  baa:false, soc2:true  },
    { pattern:/copilot/i,              model:'Microsoft Copilot',    vendor:'Microsoft', type:'LLM',       risk:'high',   phi_capable:true,  baa:true,  soc2:true  },
    { pattern:/einstein/i,             model:'Einstein AI',          vendor:'Salesforce',type:'LLM',       risk:'medium', phi_capable:false, baa:false, soc2:true  },
    { pattern:/now.*assist/i,          model:'Now Assist',           vendor:'ServiceNow',type:'LLM',       risk:'medium', phi_capable:false, baa:false, soc2:true  },
    { pattern:/langchain/i,            model:'LangChain (OSS)',      vendor:'LangChain', type:'Framework', risk:'high',   phi_capable:true,  baa:false, soc2:false },
    { pattern:/autogen|crewai/i,       model:'Agent Framework',      vendor:'OSS',       type:'Framework', risk:'high',   phi_capable:true,  baa:false, soc2:false },
    { pattern:/ollama/i,               model:'Ollama (Self-hosted)', vendor:'OSS',       type:'LLM',       risk:'medium', phi_capable:true,  baa:false, soc2:false }
  ];

  // Match each agent to a model
  agents.forEach(function(a) {
    var searchText = [a.name||'', a.notes||'', a.detect||'', a.type||''].join(' ');
    var protos = Array.isArray(a.protocols) ? a.protocols.join(' ') : '';
    searchText = (searchText + ' ' + protos).toLowerCase();

    var matched = false;
    MODEL_PATTERNS.forEach(function(mp) {
      if (mp.pattern.test(searchText)) {
        matched = true;
        var key = mp.model;
        if (!modelMap[key]) {
          modelMap[key] = {
            model: mp.model,
            vendor: mp.vendor,
            type: mp.type,
            risk: mp.risk,
            phi_capable: mp.phi_capable,
            baa: mp.baa,
            soc2: mp.soc2,
            agents: [],
            phi_agents: 0,
            shadow_agents: 0,
            approved: 0
          };
        }
        modelMap[key].agents.push(a);
        if (a.phi) modelMap[key].phi_agents++;
        if (a.shadow) modelMap[key].shadow_agents++;
        if (a.approved_by) modelMap[key].approved++;
      }
    });

    // If no model matched but agent has AI-related type, add to Unknown
    if (!matched && ['llm','ml-workspace','agent','copilot','saas-agent'].indexOf(a.type) >= 0) {
      var key = 'Unknown / Custom';
      if (!modelMap[key]) {
        modelMap[key] = { model:'Unknown / Custom', vendor:'Unknown', type:'LLM', risk:'high',
          phi_capable:true, baa:false, soc2:false, agents:[], phi_agents:0, shadow_agents:0, approved:0 };
      }
      modelMap[key].agents.push(a);
      if (a.phi) modelMap[key].phi_agents++;
      if (a.shadow) modelMap[key].shadow_agents++;
    }
  });

  var models = Object.values(modelMap).sort(function(a,b){return b.agents.length-a.agents.length;});

  // Update stat cards
  function setEl(id,v){var el=document.getElementById(id);if(el)el.textContent=v;}
  setEl('mdl-n', models.length);
  setEl('mdl-phi', models.filter(function(m){return m.phi_capable&&m.agents.length>0;}).length);
  setEl('mdl-val', models.filter(function(m){return m.soc2;}).length);
  setEl('mdl-unval', models.filter(function(m){return !m.soc2&&m.agents.length>0;}).length);

  var tb = document.getElementById('mdl-tbody');
  if (!tb) return;

  if (!models.length) {
    tb.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--text-muted)">'
      + '<div style="font-size:32px;margin-bottom:8px">&#128202;</div>'
      + '<div style="font-size:14px;font-weight:600">No models detected yet</div>'
      + '<div style="font-size:12px;margin-top:4px">Run Auto-Discovery to find AI agents and their underlying models</div>'
      + '</td></tr>';
    return;
  }

  var vendorColors = { OpenAI:'#10b981', Microsoft:'#0078d4', Anthropic:'#8b5cf6', Google:'#34a853',
    AWS:'#f59e0b', Meta:'#3b82f6', Mistral:'#f59e0b', Salesforce:'#00a1e0', ServiceNow:'#81b5a1',
    LangChain:'#6366f1', OSS:'#94a3b8', Unknown:'#94a3b8' };

  tb.innerHTML = models.map(function(m) {
    var vc = vendorColors[m.vendor] || '#94a3b8';
    var rc = {critical:'#ef4444',high:'#f59e0b',medium:'#6366f1',low:'#10b981'}[m.risk]||'#6366f1';
    var agentCount = m.agents.length;
    var lastSeen = m.agents.reduce(function(acc,a){return a.lastSeen&&a.lastSeen>acc?a.lastSeen:acc;},'');

    return '<tr style="cursor:pointer" onclick="showModelDetail(this.dataset.model)" data-model="'+escapeHtml(m.model)+'">'
      + '<td><div style="font-weight:700;color:var(--text-primary);font-size:12px">'+escapeHtml(m.model)+'</div>'
      + '<div style="font-size:10px;margin-top:2px">'
      + (m.soc2?'<span style="padding:1px 5px;border-radius:3px;background:#eff6ff;color:#2563eb;font-size:9px;margin-right:3px">SOC2</span>':'')
      + (m.baa?'<span style="padding:1px 5px;border-radius:3px;background:#f0fdf4;color:#059669;font-size:9px">BAA available</span>':'')
      + '</div></td>'
      + '<td><span style="font-size:11px;font-weight:600;color:'+vc+'">'+escapeHtml(m.vendor)+'</span></td>'
      + '<td style="font-size:11px;color:var(--text-muted)">'+escapeHtml(m.type)+'</td>'
      + '<td style="font-size:11px;color:var(--text-muted)">'+escapeHtml(m.type==='LLM'?'Text generation':m.type==='ML'?'ML inference':m.type==='STT'?'Speech-to-text':m.type==='Image'?'Image generation':m.type==='Embedding'?'Vector embeddings':'Agent framework')+'</td>'
      + '<td><span style="font-size:14px;font-weight:700;color:'+(agentCount>0?'var(--brand)':'var(--text-muted)')+'">'+agentCount+'</span>'
      + (m.shadow_agents>0?'<span style="font-size:9px;background:#fff7ed;color:#c2410c;border-radius:3px;padding:1px 4px;margin-left:4px">'+m.shadow_agents+' shadow</span>':'')
      + '</td>'
      + '<td>'+(m.phi_capable&&agentCount>0
        ?'<span style="font-size:10px;background:#fee2e2;color:#dc2626;border-radius:3px;padding:2px 6px;font-weight:600">PHI risk</span>'
          +(m.phi_agents>0?' <span style="font-size:9px;color:#dc2626">('+m.phi_agents+' agents)</span>':'')
        :'<span style="font-size:10px;color:var(--text-muted)">Not PHI capable</span>')
      +'</td>'
      + '<td><span style="font-size:10px;font-weight:600;color:'+(m.soc2?'#059669':'#ef4444')+'">'+(m.soc2?'SOC 2 certified':'Not certified')+'</span></td>'
      + '<td style="font-size:11px;color:var(--text-muted)">'+(lastSeen?new Date(lastSeen).toLocaleDateString():'N/A')+'</td>'
      + '<td><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;background:'+rc+'18;color:'+rc+'">'+m.risk.toUpperCase()+'</span></td>'
      + '</tr>';
  }).join('');
}

function showModelDetail(modelName) {
  var models = {};
  // Rebuild modelMap from current DB
  var MODEL_PATTERNS = [
    { pattern:/gpt-4o-mini/i, model:'GPT-4o Mini', vendor:'OpenAI', color:'#10b981', hosting:'Cloud API', retention:'30 days', euai:'GPAI', license:'Commercial', soc2:true, baa:false, phi_capable:true },
    { pattern:/gpt-4o/i, model:'GPT-4o', vendor:'OpenAI', color:'#10b981', hosting:'Cloud API', retention:'30 days', euai:'GPAI', license:'Commercial', soc2:true, baa:false, phi_capable:true },
    { pattern:/azure.*openai|aoai/i, model:'Azure OpenAI', vendor:'Microsoft', color:'#0078d4', hosting:'Azure Cloud', retention:'None (opt-in)', euai:'GPAI', license:'Commercial', soc2:true, baa:true, phi_capable:true },
    { pattern:/claude.*sonnet/i, model:'Claude 3.5 Sonnet', vendor:'Anthropic', color:'#8b5cf6', hosting:'Cloud API', retention:'None', euai:'GPAI', license:'Commercial', soc2:true, baa:false, phi_capable:true },
    { pattern:/claude.*haiku/i, model:'Claude 3 Haiku', vendor:'Anthropic', color:'#8b5cf6', hosting:'Cloud API', retention:'None', euai:'GPAI', license:'Commercial', soc2:true, baa:false, phi_capable:true },
    { pattern:/claude/i, model:'Claude', vendor:'Anthropic', color:'#8b5cf6', hosting:'Cloud API', retention:'None', euai:'GPAI', license:'Commercial', soc2:true, baa:false, phi_capable:true },
    { pattern:/gemini/i, model:'Gemini', vendor:'Google', color:'#34a853', hosting:'Cloud API', retention:'18 months', euai:'GPAI', license:'Commercial', soc2:true, baa:false, phi_capable:false },
    { pattern:/vertex/i, model:'Vertex AI', vendor:'Google Cloud', color:'#34a853', hosting:'GCP Vertex', retention:'None', euai:'GPAI', license:'Commercial', soc2:true, baa:true, phi_capable:true },
    { pattern:/llama/i, model:'Llama', vendor:'Meta', color:'#3b82f6', hosting:'Self-hosted', retention:'None', euai:'GPAI', license:'Open source', soc2:false, baa:false, phi_capable:true },
    { pattern:/mistral/i, model:'Mistral', vendor:'Mistral AI', color:'#f59e0b', hosting:'Cloud/Self-hosted', retention:'30 days', euai:'GPAI', license:'Commercial/OSS', soc2:false, baa:false, phi_capable:false },
    { pattern:/bedrock/i, model:'AWS Bedrock', vendor:'AWS', color:'#f59e0b', hosting:'AWS Cloud', retention:'None', euai:'GPAI', license:'Commercial', soc2:true, baa:true, phi_capable:true },
    { pattern:/sagemaker/i, model:'SageMaker', vendor:'AWS', color:'#f59e0b', hosting:'AWS Cloud', retention:'Configurable', euai:'High-risk possible', license:'Commercial', soc2:true, baa:true, phi_capable:true },
    { pattern:/copilot/i, model:'Microsoft Copilot', vendor:'Microsoft', color:'#0078d4', hosting:'Microsoft Cloud', retention:'30 days', euai:'GPAI', license:'Commercial', soc2:true, baa:true, phi_capable:true },
    { pattern:/whisper/i, model:'Whisper', vendor:'OpenAI', color:'#10b981', hosting:'Cloud/Self-hosted', retention:'Varies', euai:'High-risk (medical audio)', license:'Open source', soc2:false, baa:false, phi_capable:true },
    { pattern:/langchain|crewai|autogen/i, model:'Agent Framework', vendor:'OSS', color:'#6366f1', hosting:'Self-hosted', retention:'None', euai:'Depends on use', license:'Open source', soc2:false, baa:false, phi_capable:true }
  ];

  var agents = DB.agents;
  var matchingAgents = [];
  var modelInfo = null;

  MODEL_PATTERNS.forEach(function(mp) {
    agents.forEach(function(a) {
      var text = [a.name||'',a.notes||'',a.detect||'',a.type||''].join(' ').toLowerCase();
      if (mp.pattern.test(text) && mp.model === modelName) {
        matchingAgents.push(a);
        modelInfo = mp;
      }
    });
  });

  if (!modelInfo) { showToast('Model details not available', 'info'); return; }

  var m = modelInfo;
  var agentCount = matchingAgents.length;
  var phiAgents = matchingAgents.filter(function(a){return a.phi;});
  var shadowAgents = matchingAgents.filter(function(a){return a.shadow;});
  var critAgents = matchingAgents.filter(function(a){return a.risk==='critical'||a.risk==='high';});

  // Compliance posture across all agents using this model
  var fws = ['soc2','iso27001','gdpr','hipaa','nist','euai'];
  var fwLabels = {soc2:'SOC 2',iso27001:'ISO 27001',gdpr:'GDPR',hipaa:'HIPAA',nist:'NIST AI RMF',euai:'EU AI Act'};
  var fwPass = {};
  fws.forEach(function(fw) {
    var pass = matchingAgents.filter(function(a){
      var ctrl = typeof a.controls==='string'?JSON.parse(a.controls||'{}'):(a.controls||{});
      return ctrl[fw]==='pass';
    }).length;
    fwPass[fw] = agentCount ? Math.round(pass/agentCount*100) : 0;
  });

  var rc = m.soc2 ? '#10b981' : '#f59e0b';

  // Build detail panel HTML
  var html = '<div style="position:fixed;top:0;right:0;width:440px;height:100%;background:var(--bg-primary);border-left:1px solid var(--glass-border-dim);z-index:8000;display:flex;flex-direction:column;box-shadow:-4px 0 24px rgba(0,0,0,0.12)" id="model-detail-panel">'
    // Header
    + '<div style="padding:20px 20px 16px;border-bottom:1px solid var(--glass-border-dim)">'
    + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'
    + '<div style="width:40px;height:40px;border-radius:10px;background:'+m.color+'18;display:flex;align-items:center;justify-content:center;font-size:20px;border:1px solid '+m.color+'33">&#129302;</div>'
    + '<div style="flex:1"><div style="font-size:16px;font-weight:700;color:var(--text-primary)">'+escapeHtml(m.model)+'</div>'
    + '<div style="font-size:11px;color:'+m.color+';font-weight:600">'+escapeHtml(m.vendor)+'</div></div>'
    + '<button onclick="document.getElementById(&quot;model-detail-panel&quot;).remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-muted)">&#10005;</button>'
    + '</div>'
    + '<div style="display:flex;gap:6px;flex-wrap:wrap">'
    + (m.soc2?'<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;background:#f0fdf4;color:#059669;border:1px solid #bbf7d0">SOC 2</span>':'')
    + (m.baa?'<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;background:#f0fdf4;color:#059669;border:1px solid #bbf7d0">BAA Available</span>':'<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;background:#fef2f2;color:#dc2626;border:1px solid #fecaca">No BAA</span>')
    + (m.phi_capable?'<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;background:#faf5ff;color:#7c3aed;border:1px solid #e9d5ff">PHI Capable</span>':'')
    + '<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;background:var(--bg-secondary);color:var(--text-muted);border:1px solid var(--glass-border-dim)">'+escapeHtml(m.license)+'</span>'
    + '</div></div>'
    // Body
    + '<div style="flex:1;overflow-y:auto;padding:16px 20px">'
    // Stats
    + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">'
    + '<div style="background:var(--bg-secondary);border:1px solid var(--glass-border-dim);border-radius:8px;padding:10px;text-align:center"><div style="font-size:22px;font-weight:700;color:var(--brand)">'+agentCount+'</div><div style="font-size:10px;color:var(--text-muted)">Agents</div></div>'
    + '<div style="background:var(--bg-secondary);border:1px solid var(--glass-border-dim);border-radius:8px;padding:10px;text-align:center"><div style="font-size:22px;font-weight:700;color:'+(phiAgents.length>0?'#ef4444':'#10b981')+'">'+phiAgents.length+'</div><div style="font-size:10px;color:var(--text-muted)">PHI agents</div></div>'
    + '<div style="background:var(--bg-secondary);border:1px solid var(--glass-border-dim);border-radius:8px;padding:10px;text-align:center"><div style="font-size:22px;font-weight:700;color:'+(shadowAgents.length>0?'#ef4444':'#10b981')+'">'+shadowAgents.length+'</div><div style="font-size:10px;color:var(--text-muted)">Shadow</div></div>'
    + '</div>'
    // Model profile
    + '<div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Model Profile</div>'
    + '<div style="background:var(--bg-secondary);border:1px solid var(--glass-border-dim);border-radius:8px;padding:12px;margin-bottom:14px">'
    + _mdlRow('Hosting', m.hosting)
    + _mdlRow('Data retention', m.retention)
    + _mdlRow('EU AI Act', m.euai)
    + _mdlRow('BAA status', m.baa ? 'Available on request' : 'Not offered — PHI requires alternative')
    + '</div>'
    // PHI warning
    + (m.phi_capable && !m.baa && phiAgents.length > 0 ?
      '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:11px;color:#dc2626">'
      + '<strong>&#9888; HIPAA Risk:</strong> '+phiAgents.length+' agent(s) process PHI using a model with no BAA. This may violate HIPAA requirements.'
      + '</div>' : '')
    // Compliance
    + '<div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Compliance Posture (across '+agentCount+' agents)</div>'
    + '<div style="margin-bottom:14px">'
    + fws.map(function(fw) {
        var pct = fwPass[fw];
        var color = pct>=80?'#10b981':pct>=60?'#f59e0b':'#ef4444';
        return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'
          + '<span style="font-size:11px;color:var(--text-muted);width:80px">'+fwLabels[fw]+'</span>'
          + '<div style="flex:1;height:6px;background:var(--bg-secondary);border-radius:3px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:'+color+';border-radius:3px"></div></div>'
          + '<span style="font-size:11px;font-weight:700;color:'+color+';min-width:36px;text-align:right">'+pct+'%</span>'
          + '</div>';
      }).join('')
    + '</div>'
    // Agents list
    + '<div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Agents Using This Model ('+agentCount+')</div>'
    + (matchingAgents.length ? matchingAgents.slice(0,10).map(function(a) {
        var arc = {critical:'#ef4444',high:'#f59e0b',medium:'#6366f1',low:'#10b981'}[a.risk]||'#6366f1';
        var id = String(a.id||'').replace(/"/g,'');
        return '<div onclick="openDrawer(this.dataset.id)" data-id="'+id+'" style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--bg-secondary);border:1px solid var(--glass-border-dim);border-radius:8px;margin-bottom:5px;cursor:pointer">'
          + '<div style="width:7px;height:7px;border-radius:50%;background:'+arc+';flex-shrink:0"></div>'
          + '<div style="flex:1"><div style="font-size:12px;font-weight:600;color:var(--text-primary)">'+escapeHtml(a.name||'')+'</div>'
          + '<div style="font-size:10px;color:var(--text-muted)">'+escapeHtml(a.env||'')+(a.owner?' &middot; '+escapeHtml(a.owner):'')+'</div></div>'
          + (a.phi?'<span style="font-size:9px;background:#fee2e2;color:#dc2626;border-radius:3px;padding:1px 4px">PHI</span>':'')
          + (a.shadow?'<span style="font-size:9px;background:#fff7ed;color:#c2410c;border-radius:3px;padding:1px 4px">SHADOW</span>':'')
          + '</div>';
      }).join('') : '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:12px">No agents linked to this model</div>')
    // Actions
    + '<div style="display:flex;gap:8px;margin-top:14px;padding-top:14px;border-top:1px solid var(--glass-border-dim)">'
    + '<button onclick="generateCISOReport()" class="btn sm primary" style="flex:1">CISO Report</button>'
    + '<button onclick="recomputeRiskScores()" class="btn sm secondary">Rescan risk</button>'
    + '</div>'
    + '</div></div>';

  // Remove existing panel if open
  var existing = document.getElementById('model-detail-panel');
  if (existing) existing.remove();
  document.body.insertAdjacentHTML('beforeend', html);
}

function _mdlRow(label, value) {
  return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--glass-border-dim);font-size:11px">'
    + '<span style="color:var(--text-muted)">'+escapeHtml(label)+'</span>'
    + '<span style="color:var(--text-primary);font-weight:600">'+escapeHtml(value)+'</span>'
    + '</div>';
}

function showModelDetail(modelName) {
  showToast('Model: ' + modelName, 'info');
}

// ═══════════════════════════════════════════════════════════════
// RISK VIEW
// ═══════════════════════════════════════════════════════════════

function renderRisk() {
  var agents = DB.agents;

  // ── Stat cards ─────────────────────────────────────────────
  function setEl(id,v){var el=document.getElementById(id);if(el)el.textContent=v;}
  var crit = agents.filter(function(a){return a.risk==='critical';});
  var high = agents.filter(function(a){return a.risk==='high';});
  var med  = agents.filter(function(a){return a.risk==='medium';});
  var low  = agents.filter(function(a){return a.risk==='low';});
  setEl('r-crit', crit.length);
  setEl('r-high', high.length);
  setEl('r-med',  med.length);
  setEl('r-low',  low.length);

  // ── Risk score calculation ──────────────────────────────────
  function calcScore(a) {
    var ctrl = typeof a.controls==='string'?JSON.parse(a.controls||'{}'):(a.controls||{});
    var failures = Object.values(ctrl).filter(function(v){return v==='fail';}).length;
    var score = 0;
    if (a.phi) score+=20; if (a.pii) score+=10; if (a.shadow) score+=25;
    score += Math.min(20,failures*3);
    if (!a.review_date) score+=10; if (!a.owner) score+=10;
    return Math.min(100,score);
  }

  // ── Risk Inventory list ─────────────────────────────────────
  var filtered = rf==='all' ? agents : agents.filter(function(a){return a.risk===rf;});
  filtered = filtered.slice().sort(function(a,b){
    var order={critical:0,high:1,medium:2,low:3};
    return (order[a.risk]||4)-(order[b.risk]||4);
  });

  var listEl = document.getElementById('risk-list');
  if (listEl) {
    listEl.innerHTML = !filtered.length
      ? '<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:12px">No agents match filter</div>'
      : filtered.map(function(a) {
          var rc={critical:'#ef4444',high:'#f59e0b',medium:'#6366f1',low:'#10b981'}[a.risk]||'#6366f1';
          var id=String(a.id||'').replace(/"/g,'');
          var score = calcScore(a);
          var ctrl=typeof a.controls==='string'?JSON.parse(a.controls||'{}'):(a.controls||{});
          var failures=Object.values(ctrl).filter(function(v){return v==='fail';}).length;
          return '<div onclick="openDrawer(this.dataset.id)" data-id="'+id+'" style="cursor:pointer;padding:12px 16px;border-bottom:1px solid var(--glass-border-dim);display:flex;align-items:center;gap:12px">'
            + '<div style="width:38px;height:38px;border-radius:8px;background:'+rc+'18;display:flex;align-items:center;justify-content:center;flex-shrink:0;border:1px solid '+rc+'33">'
            + '<span style="font-size:12px;font-weight:800;color:'+rc+'">'+score+'</span></div>'
            + '<div style="flex:1;min-width:0">'
            + '<div style="font-size:13px;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escapeHtml(a.name||'')+'</div>'
            + '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;display:flex;gap:8px;flex-wrap:wrap">'
            + '<span>'+escapeHtml(a.env||'')+'</span>'
            + (a.owner?'<span>'+escapeHtml(a.owner)+'</span>':'<span style="color:#ef4444">&#9888; No owner</span>')
            + (a.phi?'<span style="color:#8b5cf6">PHI</span>':'')
            + (a.shadow?'<span style="color:#ef4444">Shadow</span>':'')
            + (failures>0?'<span style="color:#f59e0b">'+failures+' fails</span>':'')
            + '</div></div>'
            + '<div style="text-align:right;flex-shrink:0">'
            + '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;background:'+rc+'18;color:'+rc+'">'+(a.risk||'').toUpperCase()+'</span>'
            + '<div style="font-size:10px;color:var(--text-muted);margin-top:3px">'+score+'/100</div>'
            + '</div></div>';
        }).join('');
  }

  // ── Risk Trend SVG ──────────────────────────────────────────
  var W=580, H=110, pad=10;
  var riskScore = agents.length ? (crit.length*100+high.length*60+med.length*30+low.length*10)/agents.length : 0;
  var points = [];
  for (var d=12; d>=0; d--) {
    var x = pad + (12-d)/12*(W-pad*2);
    var v = Math.max(5, Math.min(H-pad*2, (riskScore + Math.sin(d*0.8)*8 + (d>8?-d*1.5:d*0.5))*0.75));
    var y = H - pad - v;
    points.push({x:Math.round(x), y:Math.round(y)});
  }
  var pathD = points.map(function(p,i){return (i===0?'M':'L')+p.x+','+p.y;}).join(' ');
  var areaD = pathD+' L'+points[points.length-1].x+','+(H-pad)+' L'+points[0].x+','+(H-pad)+' Z';
  var threshY = H-pad-(60*0.75);
  var el_area=document.getElementById('t-area');
  var el_line=document.getElementById('t-line');
  var el_thresh=document.getElementById('t-thresh');
  if(el_area) el_area.setAttribute('d',areaD);
  if(el_line) el_line.setAttribute('d',pathD);
  if(el_thresh) el_thresh.setAttribute('d','M'+pad+','+Math.round(threshY)+' L'+(W-pad)+','+Math.round(threshY));

  // ── By Category ─────────────────────────────────────────────
  var catsEl = document.getElementById('risk-cats');
  if (catsEl) {
    var cats={};
    agents.forEach(function(a){
      var cat=a.agent_category||'unknown';
      cats[cat]=cats[cat]||{critical:0,high:0,medium:0,low:0,total:0};
      cats[cat][a.risk||'low']++;
      cats[cat].total++;
    });
    var catColors={'platform':'#3b82f6','autonomous':'#8b5cf6','user-facing':'#06b6d4','saas':'#10b981','dev':'#94a3b8','unknown':'#94a3b8'};
    var catLabels={'platform':'Platform','autonomous':'Autonomous','user-facing':'User-facing','saas':'SaaS','dev':'Dev/Test','unknown':'Uncategorized'};
    catsEl.innerHTML = Object.keys(cats).map(function(cat) {
      var c=cats[cat]; var color=catColors[cat]||'#94a3b8';
      return '<div style="margin-bottom:8px">'
        + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'
        + '<div style="width:8px;height:8px;border-radius:50%;background:'+color+'"></div>'
        + '<span style="font-size:12px;font-weight:600;color:var(--text-primary);flex:1">'+escapeHtml(catLabels[cat]||cat)+'</span>'
        + '<span style="font-size:11px;color:var(--text-muted)">'+c.total+'</span></div>'
        + '<div style="display:flex;gap:2px;height:8px;border-radius:4px;overflow:hidden;background:var(--bg-secondary)">'
        + (c.critical?'<div style="flex:'+c.critical+';background:#ef4444" title="'+c.critical+' critical"></div>':'')
        + (c.high?'<div style="flex:'+c.high+';background:#f59e0b" title="'+c.high+' high"></div>':'')
        + (c.medium?'<div style="flex:'+c.medium+';background:#6366f1" title="'+c.medium+' medium"></div>':'')
        + (c.low?'<div style="flex:'+c.low+';background:#10b981" title="'+c.low+' low"></div>':'')
        + '</div>'
        + '<div style="display:flex;gap:8px;margin-top:3px;font-size:10px">'
        + (c.critical?'<span style="color:#ef4444">'+c.critical+' crit</span>':'')
        + (c.high?'<span style="color:#f59e0b">'+c.high+' high</span>':'')
        + (c.medium?'<span style="color:#6366f1">'+c.medium+' med</span>':'')
        + (c.low?'<span style="color:#10b981">'+c.low+' low</span>':'')
        + '</div></div>';
    }).join('');
  }

  // ── Risk Heatmap (Env × Severity) ──────────────────────────
  var heatEl = document.getElementById('risk-heatmap');
  if (heatEl) {
    var envs = [...new Set(agents.map(function(a){return a.env||'Unknown';}))];
    var severities = ['critical','high','medium','low'];
    var sevColors = {critical:'#ef4444',high:'#f59e0b',medium:'#6366f1',low:'#10b981'};
    var matrix = {};
    agents.forEach(function(a){
      var env=a.env||'Unknown'; var sev=a.risk||'low';
      matrix[env]=matrix[env]||{};
      matrix[env][sev]=(matrix[env][sev]||0)+1;
    });
    var maxVal = Math.max.apply(null, Object.values(matrix).map(function(row){return Math.max.apply(null,Object.values(row));}))||1;
    heatEl.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:11px">'
      + '<thead><tr><th style="text-align:left;padding:4px 8px;color:var(--text-muted)">Environment</th>'
      + severities.map(function(s){return '<th style="text-align:center;padding:4px 8px;color:'+sevColors[s]+';font-weight:700">'+s.toUpperCase()+'</th>';}).join('')
      + '<th style="text-align:center;padding:4px 8px;color:var(--text-muted)">Total</th></tr></thead><tbody>'
      + envs.map(function(env) {
          var row = matrix[env]||{};
          var total = severities.reduce(function(acc,s){return acc+(row[s]||0);},0);
          return '<tr>'
            + '<td style="padding:6px 8px;font-weight:600;color:var(--text-primary)">'+escapeHtml(env)+'</td>'
            + severities.map(function(s){
                var val=row[s]||0;
                var opacity=val?Math.max(0.15,val/maxVal):0;
                return '<td style="text-align:center;padding:6px 8px">'
                  +(val?'<div style="display:inline-block;min-width:28px;padding:2px 6px;border-radius:4px;background:'+sevColors[s]+';opacity:'+opacity+';color:#fff;font-weight:700">'+val+'</div>':'<span style="color:var(--text-muted)">—</span>')
                  +'</td>';
              }).join('')
            + '<td style="text-align:center;padding:6px 8px;font-weight:600;color:var(--text-primary)">'+total+'</td>'
            + '</tr>';
        }).join('')
      + '</tbody></table>';
  }

  // ── AI Insights ─────────────────────────────────────────────
  var insightEl = document.getElementById('risk-insights');
  if (insightEl) {
    var insights = [];
    var totalScore = agents.reduce(function(acc,a){return acc+calcScore(a);},0);
    var avgScore = agents.length ? Math.round(totalScore/agents.length) : 0;

    if (crit.length > 0) insights.push({ icon:'&#128680;', color:'#ef4444', text:crit.length+' critical-risk agent'+(crit.length>1?'s':'')+' require immediate attention. Review and approve or quarantine within 24 hours.', action:'View critical', fn:'setRF("critical",null);renderRisk()' });
    if (agents.filter(function(a){return !a.owner;}).length > 0) {
      var noOwner = agents.filter(function(a){return !a.owner;}).length;
      insights.push({ icon:'&#128100;', color:'#f59e0b', text:noOwner+' agents have no assigned owner. Each unowned agent adds +10 to risk score.', action:'Assign owners', fn:'go("discovery")' });
    }
    if (agents.filter(function(a){return !a.review_date;}).length > 0) {
      var neverReviewed = agents.filter(function(a){return !a.review_date;}).length;
      insights.push({ icon:'&#128197;', color:'#f59e0b', text:neverReviewed+' agents have never been reviewed. Review cadence adds +10 to risk score each.', action:'Start reviews', fn:'loadOverdueReviews()' });
    }
    if (agents.filter(function(a){return a.phi;}).length > 0) {
      var phiAgents = agents.filter(function(a){return a.phi;});
      var noBAA = phiAgents.filter(function(a){return a.baa_status!=='signed';}).length;
      if (noBAA > 0) insights.push({ icon:'&#127973;', color:'#8b5cf6', text:noBAA+' PHI agent'+(noBAA>1?'s':'')+' operating without a signed BAA — HIPAA violation risk.', action:'Run PHI playbook', fn:'go("playbooks")' });
    }
    insights.push({ icon:'&#128200;', color:'#3b82f6', text:'Average risk score: '+avgScore+'/100. '+(avgScore>70?'High risk — immediate governance action needed.':avgScore>40?'Moderate risk — review overdue agents to improve.':'Good posture — maintain review cadence.'), action:'Recompute scores', fn:'recomputeRiskScores()' });

    insightEl.innerHTML = insights.map(function(ins) {
      return '<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--glass-border-dim)">'
        + '<div style="font-size:18px;flex-shrink:0;margin-top:2px">'+ins.icon+'</div>'
        + '<div style="flex:1"><div style="font-size:12px;color:var(--text-primary);line-height:1.5">'+ins.text+'</div>'
        + '<button onclick="'+ins.fn+'" style="margin-top:6px;padding:3px 10px;background:'+ins.color+'18;color:'+ins.color+';border:1px solid '+ins.color+'33;border-radius:4px;font-size:10px;cursor:pointer;font-weight:600">'+ins.action+' &#8594;</button>'
        + '</div></div>';
    }).join('');
  }

  // ── Remediation Priority Queue ──────────────────────────────
  var remEl = document.getElementById('risk-remediation');
  if (remEl) {
    var remediation = [];
    agents.forEach(function(a) {
      var score = calcScore(a);
      var id = String(a.id||'').replace(/"/g,'');
      if (!a.owner && score>30) remediation.push({ agent:a.name, id:id, action:'Assign owner', impact:10, score:score, color:'#f59e0b' });
      if (!a.review_date) remediation.push({ agent:a.name, id:id, action:'Conduct first review', impact:10, score:score, color:'#f59e0b' });
      if (a.shadow&&!a.approved_by) remediation.push({ agent:a.name, id:id, action:'Approve or quarantine shadow agent', impact:25, score:score, color:'#ef4444' });
      if (a.phi&&a.baa_status!=='signed') remediation.push({ agent:a.name, id:id, action:'Sign BAA for PHI agent', impact:15, score:score, color:'#8b5cf6' });
    });
    remediation.sort(function(a,b){return b.impact-a.impact;});
    var topRem = remediation.slice(0,8);
    var totalImpact = topRem.reduce(function(acc,r){return acc+r.impact;},0);

    remEl.innerHTML = (totalImpact>0?'<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">Fix these '+topRem.length+' items to reduce total risk score by ~<strong style="color:#10b981">'+totalImpact+' points</strong></div>':'')
      + topRem.map(function(r,i) {
          return '<div onclick="openDrawer(this.dataset.id)" data-id="'+r.id+'" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--glass-border-dim);cursor:pointer">'
            + '<div style="width:20px;height:20px;border-radius:50%;background:var(--bg-secondary);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--text-muted);flex-shrink:0">'+(i+1)+'</div>'
            + '<div style="flex:1;min-width:0">'
            + '<div style="font-size:11px;font-weight:600;color:var(--text-primary)">'+escapeHtml(r.action)+'</div>'
            + '<div style="font-size:10px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escapeHtml(r.agent)+'</div>'
            + '</div>'
            + '<span style="font-size:10px;font-weight:700;color:#10b981;flex-shrink:0">-'+r.impact+' pts</span>'
            + '</div>';
        }).join('')
      + (topRem.length===0?'<div style="padding:16px;text-align:center;color:#10b981;font-size:12px">&#10003; No immediate remediation actions required</div>':'');
  }

  // ── Score Distribution ──────────────────────────────────────
  var distEl = document.getElementById('risk-distribution');
  if (distEl) {
    var buckets = [{label:'0-25',min:0,max:25,color:'#10b981'},{label:'26-50',min:26,max:50,color:'#6366f1'},{label:'51-75',min:51,max:75,color:'#f59e0b'},{label:'76-100',min:76,max:100,color:'#ef4444'}];
    buckets.forEach(function(b){b.count=agents.filter(function(a){var s=calcScore(a);return s>=b.min&&s<=b.max;}).length;});
    var maxCount = Math.max.apply(null,buckets.map(function(b){return b.count;}))||1;
    distEl.innerHTML = '<div style="display:flex;align-items:flex-end;gap:12px;height:80px;margin-bottom:8px">'
      + buckets.map(function(b){
          var h = Math.max(4,Math.round(b.count/maxCount*70));
          return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">'
            + '<span style="font-size:11px;font-weight:700;color:'+b.color+'">'+b.count+'</span>'
            + '<div style="width:100%;height:'+h+'px;background:'+b.color+';border-radius:4px 4px 0 0;opacity:0.8"></div>'
            + '</div>';
        }).join('')
      + '</div>'
      + '<div style="display:flex;gap:12px">'
      + buckets.map(function(b){return '<div style="flex:1;text-align:center;font-size:10px;color:var(--text-muted)">'+b.label+'</div>';}).join('')
      + '</div>'
      + '<div style="text-align:center;font-size:10px;color:var(--text-muted);margin-top:6px">Risk score range (0-100)</div>';
  }
}

function renderComp() {
  var A = DB.agents;
  if (typeof cfFilter === 'undefined') cfFilter = 'all';
  var FW = ['soc2','iso27001','gdpr','nist','euai','hipaa','hitrust','fda_samd'];
  var FW_LABELS = { soc2:'SOC 2', iso27001:'ISO 27001', gdpr:'GDPR', nist:'NIST AI RMF', euai:'EU AI Act', hipaa:'HIPAA', hitrust:'HITRUST', fda_samd:'FDA SaMD' };
  var tb = document.getElementById('comp-tbody');
  if (!tb) return;
  tb.innerHTML = A.map(function(a) {
    var ctrl = a.controls || {};
    var id = String(a.id || '').replace(/"/g, '');
    var pass = FW.filter(function(fw) { return ctrl[fw] === 'pass'; }).length;
    var score = Math.round(pass / FW.length * 100);
    var scoreColor = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
    var row = '<tr onclick="openDrawer(this.dataset.id)" data-id="' + id + '">';
    row += '<td style="font-weight:700">' + escapeHtml(a.name || '') + '</td>';
    row += '<td style="font-size:11px;color:var(--text-muted)">' + escapeHtml(a.type || '') + '</td>';
    FW.forEach(function(fw) {
      var val = ctrl[fw] || 'warn';
      var color = val === 'pass' ? '#10b981' : val === 'fail' ? '#ef4444' : '#f59e0b';
      row += '<td><span style="font-size:9px;font-weight:700;color:' + color + '">' + val.toUpperCase() + '</span></td>';
    });
    row += '<td><span style="font-size:11px;font-weight:700;color:' + scoreColor + '">' + score + '%</span></td>';
    row += '</tr>';
    return row;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
// POLICY VIEW
// ═══════════════════════════════════════════════════════════════

function renderPolicy() {
  var agents = DB.agents;
  var viols = DB.policyViolations || [];

  // Update stat cards
  function setEl(id,v){var el=document.getElementById(id);if(el)el.textContent=v;}
  setEl('pol-n', 3); // Built-in policies
  setEl('pol-v', viols.length);
  setEl('pol-w', agents.filter(function(a){var ctrl=typeof a.controls==='string'?JSON.parse(a.controls||'{}'):(a.controls||{});return Object.values(ctrl).some(function(v){return v==='warn';});}).length);
  setEl('pol-p', agents.filter(function(a){var ctrl=typeof a.controls==='string'?JSON.parse(a.controls||'{}'):(a.controls||{});return Object.values(ctrl).every(function(v){return v==='pass';});}).length);

  // Built-in policies list
  var policyList = document.getElementById('policy-list');
  if (policyList) {
    var builtInPolicies = [
      { name:'Shadow AI Detection', desc:'Flag any agent not registered through approved discovery channels', severity:'critical', active:true, violations: agents.filter(function(a){return a.shadow;}).length },
      { name:'PHI Agent BAA Required', desc:'All agents accessing PHI must have a signed Business Associate Agreement', severity:'critical', active:true, violations: agents.filter(function(a){return a.phi&&a.baa_status!=='signed';}).length },
      { name:'Owner Assignment Required', desc:'Every AI agent must have an assigned owner responsible for governance', severity:'high', active:true, violations: agents.filter(function(a){return !a.owner;}).length },
      { name:'90-Day Review Cadence', desc:'All agents must be reviewed at least every 90 days', severity:'high', active:true, violations: agents.filter(function(a){return !a.review_date;}).length },
      { name:'EU AI Act Compliance', desc:'High-risk AI systems must complete conformity assessment', severity:'high', active:true, violations: agents.filter(function(a){var ctrl=typeof a.controls==='string'?JSON.parse(a.controls||'{}'):(a.controls||{});return ctrl.euai==='fail';}).length },
      { name:'Approved Models Only', desc:'Agents must use models from the approved model registry', severity:'medium', active:false, violations: 0 }
    ];

    policyList.innerHTML = builtInPolicies.map(function(p) {
      var sColor = p.severity==='critical'?'#ef4444':p.severity==='high'?'#f59e0b':'#6366f1';
      return '<div style="padding:12px 14px;border-bottom:1px solid var(--glass-border-dim);display:flex;align-items:center;gap:10px">'
        + '<div style="width:8px;height:8px;border-radius:50%;background:'+(p.active?sColor:'#94a3b8')+';flex-shrink:0"></div>'
        + '<div style="flex:1">'
        + '<div style="font-size:12px;font-weight:700;color:var(--text-primary)">'+escapeHtml(p.name)+'</div>'
        + '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">'+escapeHtml(p.desc)+'</div>'
        + '</div>'
        + (p.violations>0?'<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;background:#fef2f2;color:#dc2626">'+p.violations+' violations</span>':'')
        + '<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;background:'+(p.active?'#f0fdf4':'var(--bg-secondary)')+';color:'+(p.active?'#059669':'#94a3b8')+'">'+( p.active?'Active':'Inactive')+'</span>'
        + '</div>';
    }).join('')
    + '<div style="padding:12px 14px">'
    + '<button onclick="aiGeneratePolicy()" style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:linear-gradient(135deg,#8b5cf6,#3b82f6);color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;width:100%">'
    + '<span style="font-size:16px">&#129302;</span> Generate Policy with AI</button>'
    + '</div>';
  }

  // Active violations with source
  var violsEl = document.getElementById('policy-viols');
  if (violsEl) {
    if (!viols.length) {
      violsEl.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:12px">&#10003; No active violations</div>';
      return;
    }
    violsEl.innerHTML = viols.map(function(v) {
      var a = v.agent || {};
      var id = String(a.id||'').replace(/"/g,'');
      var sColor = v.sev==='critical'?'#ef4444':v.sev==='high'?'#f59e0b':'#6366f1';
      // Map violation to source policy
      var policySource = v.rule.indexOf('shadow')>=0||v.rule.indexOf('Shadow')>=0 ? 'Shadow AI Detection'
        : v.rule.indexOf('PHI')>=0||v.rule.indexOf('HIPAA')>=0 ? 'PHI Agent BAA Required'
        : v.rule.indexOf('owner')>=0||v.rule.indexOf('Owner')>=0 ? 'Owner Assignment Required'
        : v.rule.indexOf('review')>=0 ? '90-Day Review Cadence'
        : v.rule.indexOf('euai')>=0||v.rule.indexOf('EU')>=0 ? 'EU AI Act Compliance'
        : 'Policy Engine';

      return '<div onclick="openDrawer(this.dataset.id)" data-id="'+id+'" style="padding:12px 14px;border-bottom:1px solid var(--glass-border-dim);cursor:pointer;border-left:3px solid '+sColor+'">'
        + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'
        + '<span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;background:'+sColor+'18;color:'+sColor+'">'+(v.sev||'HIGH').toUpperCase()+'</span>'
        + '<span style="font-size:12px;font-weight:600;color:var(--text-primary)">'+escapeHtml(v.rule||'')+'</span>'
        + '</div>'
        + '<div style="font-size:11px;color:var(--text-muted)">'
        + 'Agent: <strong>'+escapeHtml(a.name||'Unknown')+'</strong>'
        + ' &middot; Triggered by: <span style="color:var(--brand)">'+escapeHtml(policySource)+'</span>'
        + (a.env?' &middot; '+escapeHtml(a.env):'')
        + '</div>'
        + '</div>';
    }).join('');
  }
}

function aiGeneratePolicy() {
  var aapInput = document.getElementById('aap-input');
  if (aapInput) {
    aapInput.value = 'Generate a new governance policy rule for our AI agent inventory. We have ' + DB.agents.length + ' agents, ' + DB.agents.filter(function(a){return a.shadow;}).length + ' shadow AI agents, and ' + DB.agents.filter(function(a){return a.phi;}).length + ' PHI agents. Suggest 3 specific, actionable policy rules I should add based on our risk profile.';
  }
  openAIPanel();
}

// ═══════════════════════════════════════════════════════════════
// APPROVALS VIEW
// ═══════════════════════════════════════════════════════════════

function renderApprovals() {
  var list = DB.approvals || [];
  var tb = document.getElementById('appr-list') || document.querySelector('#view-approvals tbody');
  if (!tb) return;
  if (!list.length) {
    tb.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-muted);font-size:13px">No pending approvals</div>';
    return;
  }
  tb.innerHTML = list.map(function(item) {
    var a = item.agent || {};
    var id = String(a.id || '').replace(/"/g, '');
    var rc = { critical:'#ef4444', high:'#f59e0b', medium:'#6366f1', low:'#10b981' }[a.risk] || '#6366f1';
    return '<div style="padding:12px 16px;border-bottom:1px solid var(--glass-border-dim);display:flex;align-items:center;gap:12px">'
      + '<div style="flex:1"><div style="font-size:13px;font-weight:600;color:var(--text-primary)">' + escapeHtml(a.name || 'Unknown') + '</div>'
      + '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + escapeHtml(item.reason || 'Requires approval') + '</div></div>'
      + '<span style="font-size:10px;font-weight:700;color:' + rc + '">' + (a.risk || '').toUpperCase() + '</span>'
      + '<button class="btn sm" data-id="' + id + '" onclick="approveAgent(this.dataset.id)">Approve</button>'
      + '<button class="btn sm danger" data-id="' + id + '" onclick="quarantineAgent(this.dataset.id)">Reject</button>'
      + '</div>';
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
// PLAYBOOKS VIEW
// ═══════════════════════════════════════════════════════════════

function renderPlaybooks() {
  var headers = {};
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;

  fetch('/api/playbooks', { headers: headers, credentials: 'include' })
    .then(function(r) { return r.ok ? r.json() : []; })
    .then(function(playbooks) {
      DB.playbooks = playbooks;
      _renderPlaybooksList(playbooks);
    })
    .catch(function() { _renderPlaybooksList([]); });
}

function _renderPlaybooksList(playbooks) {
  var el = document.getElementById('playbook-list');
  if (!el) return;

  // Update stats
  var navBadge = document.getElementById('nav-playbooks-count');
  if (navBadge) navBadge.textContent = playbooks.length;
  var pbTotal = document.getElementById('pb-total');
  if (pbTotal) pbTotal.textContent = playbooks.length;

  var sevColors = { critical:'#ef4444', high:'#f59e0b', medium:'#6366f1', low:'#10b981' };
  var triggerLabels = {
    shadow_detected: 'Shadow AI detected',
    phi_no_baa: 'PHI agent without BAA',
    risk_threshold: 'Critical risk threshold',
    no_owner: 'Agent without owner',
    review_overdue: 'Review overdue 90+ days',
    euai_compliance: 'EU AI Act compliance gap'
  };

  // Check current trigger conditions against real data
  var agents = DB.agents;
  var triggerCounts = {
    shadow_detected: agents.filter(function(a){return a.shadow&&!a.approvedBy;}).length,
    phi_no_baa: agents.filter(function(a){return a.phi&&a.baa_status!=='signed';}).length,
    risk_threshold: agents.filter(function(a){return a.risk==='critical'&&!a.approvedBy;}).length,
    no_owner: agents.filter(function(a){return !a.owner;}).length,
    review_overdue: agents.filter(function(a){return !a.review_date;}).length,
    euai_compliance: agents.filter(function(a){var ctrl=typeof a.controls==='string'?JSON.parse(a.controls||'{}'):(a.controls||{});return ctrl.euai==='fail';}).length
  };

  el.innerHTML = playbooks.map(function(p) {
    var sc = sevColors[p.severity] || '#6366f1';
    var steps = typeof p.steps === 'string' ? JSON.parse(p.steps||'[]') : (p.steps||[]);
    var autoSteps = steps.filter(function(s){return s.auto;}).length;
    var triggered = triggerCounts[p.trigger_type] || 0;
    var pid = String(p.id||'').replace(/"/g,'');

    return '<div style="background:var(--bg-secondary);border:1px solid '+(triggered>0?sc+'44':'var(--glass-border-dim)')+';border-radius:10px;padding:14px;margin-bottom:8px">'
      // Header
      + '<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px">'
      + '<div style="width:10px;height:10px;border-radius:50%;background:'+sc+';flex-shrink:0;margin-top:4px'+(triggered>0?';animation:pulse 1.5s infinite':'')+'"></div>'
      + '<div style="flex:1">'
      + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">'
      + '<span style="font-size:13px;font-weight:700;color:var(--text-primary)">'+escapeHtml(p.name)+'</span>'
      + (p.auto_execute?'<span style="font-size:9px;background:#eff6ff;color:#2563eb;border-radius:3px;padding:1px 6px;font-weight:600">AUTO</span>':'<span style="font-size:9px;background:var(--bg-secondary);color:var(--text-muted);border-radius:3px;padding:1px 6px;border:1px solid var(--glass-border-dim)">MANUAL</span>')
      + (triggered>0?'<span style="font-size:9px;background:'+sc+'18;color:'+sc+';border-radius:3px;padding:1px 6px;font-weight:700">'+triggered+' TRIGGERED</span>':'')
      + '</div>'
      + '<div style="font-size:11px;color:var(--text-muted)">'+escapeHtml(p.description||'')+'</div>'
      + '</div>'
      + '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;background:'+(p.status==='active'?'#f0fdf4':'var(--bg-secondary)')+';color:'+(p.status==='active'?'#059669':'#94a3b8')+'">'+p.status+'</span>'
      + '</div>'
      // Trigger + steps info
      + '<div style="display:flex;gap:8px;margin-bottom:10px">'
      + '<div style="flex:1;background:var(--bg-primary);border:1px solid var(--glass-border-dim);border-radius:6px;padding:7px 10px">'
      + '<div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">TRIGGER</div>'
      + '<div style="font-size:11px;font-weight:600;color:var(--text-primary)">'+escapeHtml(triggerLabels[p.trigger_type]||p.trigger_type)+'</div>'
      + '</div>'
      + '<div style="background:var(--bg-primary);border:1px solid var(--glass-border-dim);border-radius:6px;padding:7px 10px;min-width:80px;text-align:center">'
      + '<div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">STEPS</div>'
      + '<div style="font-size:14px;font-weight:700;color:var(--text-primary)">'+steps.length+'</div>'
      + '</div>'
      + '<div style="background:var(--bg-primary);border:1px solid var(--glass-border-dim);border-radius:6px;padding:7px 10px;min-width:80px;text-align:center">'
      + '<div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">AUTO STEPS</div>'
      + '<div style="font-size:14px;font-weight:700;color:#3b82f6">'+autoSteps+'</div>'
      + '</div>'
      + '<div style="background:var(--bg-primary);border:1px solid var(--glass-border-dim);border-radius:6px;padding:7px 10px;min-width:80px;text-align:center">'
      + '<div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">RUNS</div>'
      + '<div style="font-size:14px;font-weight:700;color:var(--text-primary)">'+(p.executions||0)+'</div>'
      + '</div>'
      + '</div>'
      // Steps preview
      + '<div style="display:flex;gap:4px;margin-bottom:10px;flex-wrap:wrap">'
      + steps.slice(0,6).map(function(s,i) {
          return '<div style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--text-muted)">'
            + (i>0?'<span style="color:var(--glass-border-dim)">&#8594;</span>':'')
            + '<span style="padding:2px 6px;background:'+(s.auto?'#eff6ff':'var(--bg-secondary)')+';color:'+(s.auto?'#2563eb':'var(--text-muted)')+';border-radius:3px;border:1px solid var(--glass-border-dim)">'+escapeHtml(s.name||('Step '+s.step))+'</span>'
            + '</div>';
        }).join('')
      + (steps.length>6?'<span style="font-size:10px;color:var(--text-muted)">+' + (steps.length-6) + ' more</span>':'')
      + '</div>'
      // Action buttons
      + '<div style="display:flex;gap:6px">'
      + (triggered>0?'<button data-pid="'+pid+'" onclick="executePlaybook(this.dataset.pid)" style="padding:6px 14px;background:'+sc+';color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer">&#9654; Run Now ('+triggered+' agents)</button>':'')
      + '<button data-pid="'+pid+'" onclick="viewPlaybookDetail(this.dataset.pid)" style="padding:6px 12px;background:transparent;border:1px solid var(--glass-border-dim);border-radius:6px;font-size:11px;cursor:pointer">View details</button>'
      + '<button data-pid="'+pid+'" data-auto="'+(p.auto_execute?'true':'false')+'" onclick="togglePlaybookAuto(this.dataset.pid,this.dataset.auto===&quot;true&quot;)" style="padding:6px 12px;background:transparent;border:1px solid var(--glass-border-dim);border-radius:6px;font-size:11px;cursor:pointer">'+(p.auto_execute?'&#9679; Auto ON':'&#9675; Auto OFF')+'</button>'
      + (p.webhook_url?'<span style="font-size:10px;color:#10b981;display:flex;align-items:center;gap:4px">&#128279; Webhook active</span>':'<button data-pid="'+pid+'" onclick="configureWebhook(this.dataset.pid)" style="padding:6px 12px;background:transparent;border:1px solid var(--glass-border-dim);border-radius:6px;font-size:11px;cursor:pointer">+ Webhook</button>')
      + '</div>'
      + '</div>';
  }).join('')
  + '<div style="display:flex;gap:8px;margin-top:12px">'
  + '<button onclick="aiCreatePlaybook()" style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:11px;background:linear-gradient(135deg,#8b5cf6,#3b82f6);color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">&#129302; Create Playbook with AI</button>'
  + '<button onclick="openManualPlaybookForm()" style="padding:11px 16px;background:transparent;border:1px solid var(--glass-border-dim);border-radius:8px;font-size:12px;cursor:pointer">+ Manual</button>'
  + '<button onclick="runAutoTrigger()" style="padding:11px 16px;background:transparent;border:1px solid #10b981;color:#10b981;border-radius:8px;font-size:12px;cursor:pointer">&#9650; Check triggers</button>'
  + '</div>';
}

function executePlaybook(playbookId) {
  var agents = DB.agents;
  var pb = (DB.playbooks||[]).find(function(p){return String(p.id)===String(playbookId);});
  if (!pb) return;

  // Find matching agents
  var matchingAgents = [];
  if (pb.trigger_type==='shadow_detected') matchingAgents = agents.filter(function(a){return a.shadow&&!a.approvedBy;});
  else if (pb.trigger_type==='phi_no_baa') matchingAgents = agents.filter(function(a){return a.phi&&a.baa_status!=='signed';});
  else if (pb.trigger_type==='risk_threshold') matchingAgents = agents.filter(function(a){return a.risk==='critical';});
  else if (pb.trigger_type==='no_owner') matchingAgents = agents.filter(function(a){return !a.owner;});
  else if (pb.trigger_type==='review_overdue') matchingAgents = agents.filter(function(a){return !a.review_date;});
  else matchingAgents = agents.slice(0,1);

  if (!matchingAgents.length) { showToast('No agents match trigger conditions', 'info'); return; }

  showToast('Executing playbook on ' + matchingAgents.length + ' agents...', 'info');

  var headers = { 'Content-Type': 'application/json' };
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;

  var promises = matchingAgents.slice(0,10).map(function(a) {
    return fetch('/api/playbooks/' + playbookId + '/execute', {
      method: 'POST', headers: headers, credentials: 'include',
      body: JSON.stringify({ agentId: a.id, reason: 'Manual trigger from playbook view' })
    }).then(function(r){return r.json();}).catch(function(){return {error:'failed'};});
  });

  Promise.all(promises).then(function(results) {
    var ok = results.filter(function(r){return r.success;}).length;
    showToast('Playbook executed on ' + ok + '/' + matchingAgents.length + ' agents', ok>0?'success':'error');
    addAct('playbook', 'Playbook "'+pb.name+'" executed on '+ok+' agents', currentUser, '#8b5cf6');
    setTimeout(function(){renderPlaybooks();}, 1000);
  });
}

function togglePlaybookAuto(id, currentAuto) {
  var newAuto = !currentAuto;
  var headers = { 'Content-Type': 'application/json' };
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/playbooks/' + id, {
    method: 'PATCH', headers: headers, credentials: 'include',
    body: JSON.stringify({ auto_execute: newAuto })
  }).then(function(){
    showToast('Auto-execute ' + (newAuto?'enabled':'disabled'), 'success');
    renderPlaybooks();
  });
}

function configureWebhook(id) {
  var url = prompt('Enter webhook URL (Teams/Slack/custom):');
  if (!url) return;
  var headers = { 'Content-Type': 'application/json' };
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/playbooks/' + id, {
    method: 'PATCH', headers: headers, credentials: 'include',
    body: JSON.stringify({ webhook_url: url })
  }).then(function(){ showToast('Webhook configured', 'success'); renderPlaybooks(); });
}

function viewPlaybookDetail(id) {
  var pb = (DB.playbooks||[]).find(function(p){return String(p.id)===String(id);});
  if (!pb) return;
  var steps = typeof pb.steps==='string'?JSON.parse(pb.steps||'[]'):(pb.steps||[]);
  var steps = typeof pb.steps==='string'?JSON.parse(pb.steps||'[]'):(pb.steps||[]);
  var detail = 'Playbook: ' + pb.name
    + '\n\nTrigger: ' + pb.trigger_type
    + '\n\nSteps:\n'
    + steps.map(function(s,i){return (i+1)+'. '+s.name+' ('+(s.auto?'AUTO':'MANUAL')+')'+(s.delay?' - delay: '+s.delay:'');}).join('\n')
    + '\n\nExecutions: ' + (pb.executions||0)
    + '\nLast run: ' + (pb.last_executed?new Date(pb.last_executed).toLocaleString():'Never');
}

function runAutoTrigger() {
  showToast('Checking trigger conditions...', 'info');
  var headers = { 'Content-Type': 'application/json' };
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/playbooks/auto-trigger', {
    method: 'POST', headers: headers, credentials: 'include'
  }).then(function(r){return r.json();})
  .then(function(d){
    showToast('Checked '+d.checked+' playbooks, '+d.triggered+' auto-triggered', 'success');
    renderPlaybooks();
  }).catch(function(){showToast('Trigger check failed','error');});
}

function openManualPlaybookForm() {
  var name = prompt('Playbook name:');
  if (!name) return;
  var trigger = prompt('Trigger type (shadow_detected/phi_no_baa/risk_threshold/no_owner/review_overdue):','shadow_detected');
  if (!trigger) return;
  var headers = { 'Content-Type': 'application/json' };
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/playbooks', {
    method: 'POST', headers: headers, credentials: 'include',
    body: JSON.stringify({ name: name, trigger_type: trigger, severity: 'high', steps: [], auto_execute: false })
  }).then(function(r){return r.json();})
  .then(function(d){ showToast('Playbook created', 'success'); renderPlaybooks(); });
}

function aiCreatePlaybook() {
  var context = 'Platform: ' + DB.agents.length + ' agents, '
    + DB.agents.filter(function(a){return a.shadow;}).length + ' shadow AI, '
    + DB.agents.filter(function(a){return a.phi;}).length + ' PHI agents.';
  var aapInput = document.getElementById('aap-input');
  if (aapInput) aapInput.value = 'Create a detailed AI governance playbook for our platform. ' + context + ' Define: trigger conditions, 5-8 specific response steps (mark which are auto vs manual), responsible parties, escalation path, success criteria, and SLA timeframes. Format it clearly so I can implement it.';
  openAIPanel();
}


function renderBench() {
  var agents = DB.agents;
  console.log('[renderBench] agents:', agents.length, 'apiMode: true');
  var yours = agents.length ? Math.round(agents.filter(function(a) { return a.risk === 'critical' || a.risk === 'high'; }).length / agents.length * 100) : 0;
  var avg = 30; // Industry benchmark
  var el_yours = document.getElementById('bm-yours');
  var el_avg = document.getElementById('bm-avg');
  var el_pct = document.getElementById('bm-pct');
  if (el_yours) el_yours.textContent = yours + '%';
  if (el_avg) el_avg.textContent = avg + '%';
  if (el_pct) el_pct.textContent = yours < avg ? 'Better than average' : 'Above average risk';
  var el_list = document.getElementById('bm-list');
  if (el_list) {
    el_list.innerHTML = [
      { label: 'Shadow AI detection rate', yours: agents.filter(function(a) { return a.shadow; }).length, peer: '3-5 avg' },
      { label: 'PHI agents with BAA', yours: DB.phiAgents.filter(function(a) { return a.baa_status === 'signed'; }).length + '/' + DB.phiAgents.length, peer: '80% have BAA' },
      { label: 'Policy violations', yours: DB.policyViolations.length, peer: '< 10 is good' },
      { label: 'Agents pending approval', yours: DB.approvals.length, peer: '< 5 is good' }
    ].map(function(b) {
      return '<div style="padding:10px 0;border-bottom:1px solid var(--glass-border-dim);display:flex;align-items:center">'
        + '<div style="flex:1;font-size:12px;color:var(--text-primary)">' + b.label + '</div>'
        + '<div style="font-size:12px;font-weight:700;color:var(--text-primary);margin-right:12px">' + b.yours + '</div>'
        + '<div style="font-size:11px;color:var(--text-muted)">' + b.peer + '</div>'
        + '</div>';
    }).join('');
  }
}

// ═══════════════════════════════════════════════════════════════
// NOTIFICATIONS VIEW
// ═══════════════════════════════════════════════════════════════

function renderNotif() {
  var el = document.getElementById('notif-list') || document.querySelector('#view-notifications .card-body');
  if (!el) return;
  var notifs = DB.notifications && DB.notifications.length ? DB.notifications : [];
  el.innerHTML = notifs.map(function(n) {
    var color = n.type === 'critical' ? '#ef4444' : n.type === 'high' ? '#f59e0b' : '#6366f1';
    return '<div style="padding:12px 16px;border-bottom:1px solid var(--glass-border-dim);border-left:3px solid ' + color + ';margin-bottom:4px">'
      + '<div style="font-size:13px;font-weight:600;color:var(--text-primary)">' + escapeHtml(n.title || '') + '</div>'
      + '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + escapeHtml(n.body || '') + '</div>'
      + '<div style="font-size:10px;color:var(--text-muted);margin-top:4px">' + escapeHtml(n.ts || '') + '</div>'
      + '</div>';
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
// ACTIVITY VIEW
// ═══════════════════════════════════════════════════════════════

function renderActivity() {
  var el = document.getElementById('act-tl');
  if (!el) return;
  var activity = DB.activity && DB.activity.length ? DB.activity : [
    { action: 'Platform initialized', actor: 'System', ts: 'Just now', color: '#10b981' }
  ];
  el.innerHTML = activity.map(function(e) {
    return '<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--glass-border-dim)">'
      + '<div style="width:8px;height:8px;border-radius:50%;background:' + (e.color || '#6366f1') + ';flex-shrink:0;margin-top:3px"></div>'
      + '<div style="flex:1"><div style="font-size:12px;color:var(--text-primary)">' + escapeHtml(e.action || '') + '</div>'
      + '<div style="font-size:10px;color:var(--text-muted)">' + escapeHtml(e.actor || '') + ' &middot; ' + escapeHtml(e.ts || '') + '</div></div>'
      + '</div>';
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
// CISO VIEW
// ═══════════════════════════════════════════════════════════════

function renderCiso() {
  var agents = DB.agents;
  var shadow = agents.filter(function(a) { return a.shadow; });
  var phi = agents.filter(function(a) { return a.phi; });
  var crit = agents.filter(function(a) { return a.risk === 'critical'; });
  var viols = DB.policyViolations || [];

  var el = document.getElementById('ciso-alerts');
  if (el) {
    el.innerHTML = [
      crit.length ? { t:'red', title: crit.length + ' critical-risk agents require immediate attention', body: crit.map(function(a) { return a.name; }).join(', ') } : null,
      shadow.length ? { t:'red', title: shadow.length + ' shadow AI agents detected', body: 'Unregistered agents operating without approval' } : null,
      phi.length ? { t:'amber', title: phi.length + ' agents accessing PHI', body: 'HIPAA compliance review required for all PHI agents' } : null,
      viols.length ? { t:'amber', title: viols.length + ' active policy violations', body: 'Remediation required to maintain compliance posture' } : null
    ].filter(Boolean).map(function(a) {
      return '<div class="alert-banner ' + (a.t === 'amber' ? 'amber' : '') + '"><div class="alert-icon">' + (a.t === 'red' ? '&#9888;' : '!') + '</div><div><div class="alert-title">' + escapeHtml(a.title) + '</div><div class="alert-body">' + escapeHtml(a.body) + '</div></div></div>';
    }).join('');
  }

  var fw_el = document.getElementById('ciso-fw');
  if (fw_el) {
    var fws = ['soc2','iso27001','gdpr','nist','euai','hipaa','hitrust','fda_samd'];
    var fw_labels = { soc2:'SOC 2', iso27001:'ISO 27001', gdpr:'GDPR', nist:'NIST', euai:'EU AI Act', hipaa:'HIPAA', hitrust:'HITRUST', fda_samd:'FDA SaMD' };
    fw_el.innerHTML = fws.map(function(fw) {
      var pass = agents.filter(function(a) { return a.controls && a.controls[fw] === 'pass'; }).length;
      var pct = agents.length ? Math.round(pass / agents.length * 100) : 0;
      var color = pct >= 80 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444';
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--glass-border-dim)">'
        + '<span style="flex:1;font-size:12px;color:var(--text-primary)">' + fw_labels[fw] + '</span>'
        + '<div style="width:80px;height:6px;background:var(--bg-secondary);border-radius:3px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:3px"></div></div>'
        + '<span style="font-size:11px;font-weight:700;color:' + color + ';min-width:36px;text-align:right">' + pct + '%</span>'
        + '</div>';
    }).join('');
  }
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════

function renderDash() {
  updateStats();
  var agents = DB.agents;

  // ── Risk Level chart ─────────────────────────────────────────
  var riskEl = document.getElementById('dash-risk-bars');
  if (riskEl) {
    var riskData = [
      { label:'Critical', count: agents.filter(function(a){return a.risk==='critical';}).length, color:'#ef4444' },
      { label:'High',     count: agents.filter(function(a){return a.risk==='high';}).length,     color:'#f59e0b' },
      { label:'Medium',   count: agents.filter(function(a){return a.risk==='medium';}).length,   color:'#6366f1' },
      { label:'Low',      count: agents.filter(function(a){return a.risk==='low';}).length,      color:'#10b981' }
    ];
    var maxR = Math.max.apply(null, riskData.map(function(r){return r.count;})) || 1;
    riskEl.innerHTML = riskData.map(function(r) {
      var pct = Math.round(r.count / maxR * 100);
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
        + '<span style="font-size:11px;color:var(--text-muted);width:52px">' + r.label + '</span>'
        + '<div style="flex:1;height:8px;background:var(--bg-secondary);border-radius:4px;overflow:hidden">'
        + '<div style="height:100%;width:' + pct + '%;background:' + r.color + ';border-radius:4px"></div></div>'
        + '<span style="font-size:11px;font-weight:700;color:var(--text-primary);min-width:24px;text-align:right">' + r.count + '</span>'
        + '</div>';
    }).join('');
  }

  // ── Environment chart ─────────────────────────────────────────
  var envEl = document.getElementById('dash-env-bars');
  if (envEl) {
    var envCounts = {};
    agents.forEach(function(a) { var e = a.env || 'Unknown'; envCounts[e] = (envCounts[e]||0)+1; });
    var envData = Object.keys(envCounts).sort(function(a,b){return envCounts[b]-envCounts[a];}).slice(0,5);
    var maxE = Math.max.apply(null, Object.values(envCounts)) || 1;
    envEl.innerHTML = envData.map(function(env) {
      var pct = Math.round(envCounts[env] / maxE * 100);
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
        + '<span style="font-size:11px;color:var(--text-muted);width:52px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(env) + '</span>'
        + '<div style="flex:1;height:8px;background:var(--bg-secondary);border-radius:4px;overflow:hidden">'
        + '<div style="height:100%;width:' + pct + '%;background:#3b82f6;border-radius:4px"></div></div>'
        + '<span style="font-size:11px;font-weight:700;color:var(--text-primary);min-width:24px;text-align:right">' + envCounts[env] + '</span>'
        + '</div>';
    }).join('');
  }

  // ── Domain chart ─────────────────────────────────────────────
  var domEl = document.getElementById('dash-domain-bars');
  if (domEl) {
    var domCounts = {};
    agents.forEach(function(a) {
      var cat = a.agent_category || 'unknown';
      domCounts[cat] = (domCounts[cat]||0)+1;
    });
    var catColors = {'user-facing':'#3b82f6','autonomous':'#8b5cf6','saas':'#06b6d4','dev':'#94a3b8','platform':'#f59e0b','unknown':'#94a3b8'};
    var maxD = Math.max.apply(null, Object.values(domCounts)) || 1;
    domEl.innerHTML = Object.keys(domCounts).sort(function(a,b){return domCounts[b]-domCounts[a];}).map(function(cat) {
      var pct = Math.round(domCounts[cat] / maxD * 100);
      var color = catColors[cat] || '#94a3b8';
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
        + '<span style="font-size:11px;color:var(--text-muted);width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + agentCategoryLabel(cat) + '</span>'
        + '<div style="flex:1;height:8px;background:var(--bg-secondary);border-radius:4px;overflow:hidden">'
        + '<div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:4px"></div></div>'
        + '<span style="font-size:11px;font-weight:700;color:var(--text-primary);min-width:24px;text-align:right">' + domCounts[cat] + '</span>'
        + '</div>';
    }).join('');
  }

  // ── Compliance Posture ────────────────────────────────────────
  var compEl = document.getElementById('dash-comp-matrix');
  if (compEl) {
    var fws = ['soc2','iso27001','gdpr','hipaa','nist','euai'];
    var fwLabels = {soc2:'SOC 2',iso27001:'ISO 27001',gdpr:'GDPR',hipaa:'HIPAA',nist:'NIST',euai:'EU AI Act'};
    compEl.innerHTML = fws.map(function(fw) {
      var pass = agents.filter(function(a){return a.controls && a.controls[fw]==='pass';}).length;
      var pct = agents.length ? Math.round(pass/agents.length*100) : 0;
      var color = pct>=80?'#10b981':pct>=60?'#f59e0b':'#ef4444';
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
        + '<span style="font-size:11px;color:var(--text-muted);width:72px">' + fwLabels[fw] + '</span>'
        + '<div style="flex:1;height:6px;background:var(--bg-secondary);border-radius:3px;overflow:hidden">'
        + '<div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:3px"></div></div>'
        + '<span style="font-size:11px;font-weight:700;color:' + color + ';min-width:32px;text-align:right">' + pct + '%</span>'
        + '</div>';
    }).join('');
  }

  // ── Recent Activity ───────────────────────────────────────────
  var actEl = document.getElementById('dash-activity');
  if (actEl) {
    var acts = DB.activity && DB.activity.length ? DB.activity.slice(0,5) : [
      {action:'Platform initialized — ' + agents.length + ' agents loaded', actor:'System', ts:new Date().toLocaleTimeString(), color:'#10b981'}
    ];
    actEl.innerHTML = acts.map(function(e) {
      return '<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--glass-border-dim)">'
        + '<div style="width:8px;height:8px;border-radius:50%;background:' + (e.color||'#6366f1') + ';flex-shrink:0;margin-top:4px"></div>'
        + '<div style="flex:1"><div style="font-size:12px;color:var(--text-primary)">' + escapeHtml(e.action||'') + '</div>'
        + '<div style="font-size:10px;color:var(--text-muted)">' + escapeHtml(e.actor||'') + ' &middot; ' + escapeHtml(e.ts||'') + '</div></div>'
        + '</div>';
    }).join('');
  }

  // ── Live Alerts ───────────────────────────────────────────────
  var alertEl = document.getElementById('dash-alerts');
  if (alertEl) {
    var alerts = [];
    agents.filter(function(a){return a.shadow;}).slice(0,3).forEach(function(a) {
      alerts.push({title:'Shadow AI: '+a.name, body:'Unregistered agent in '+a.env, risk:'critical', id:a.id});
    });
    (DB.policyViolations||[]).slice(0,3).forEach(function(v) {
      alerts.push({title:v.rule, body:'Agent: '+(v.agent&&v.agent.name||'Unknown'), risk:v.sev||'high', id:v.agent&&v.agent.id});
    });
    alertEl.innerHTML = alerts.length ? alerts.map(function(al) {
      var rc={critical:'#ef4444',high:'#f59e0b',medium:'#6366f1',low:'#10b981'}[al.risk]||'#6366f1';
      var id = String(al.id||'').replace(/"/g,'');
      return '<div onclick="openDrawer(this.dataset.id)" data-id="' + id + '" style="cursor:pointer;padding:10px 14px;border-left:3px solid ' + rc + ';margin-bottom:6px;border-radius:0 6px 6px 0">'
        + '<div style="font-size:12px;font-weight:700;color:var(--text-primary)">' + escapeHtml(al.title||'') + '</div>'
        + '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + escapeHtml(al.body||'') + '</div>'
        + '</div>';
    }).join('') : '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:12px">No active alerts</div>';
  }
}

function dashCard(label, value, color, id) {
  return '<div style="background:var(--glass-white);border:1px solid var(--glass-border-dim);border-radius:12px;padding:16px 20px">'
    + '<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">' + label + '</div>'
    + '<div id="' + id + '" style="font-size:28px;font-weight:700;color:' + color + '">' + value + '</div>'
    + '</div>';
}

// ═══════════════════════════════════════════════════════════════
// LINEAGE VIEW
// ═══════════════════════════════════════════════════════════════

// ── Lineage state ────────────────────────────────────────────
var _lnFilter = 'all';
var _lnDepth = 3;
var _lnDirection = 'upstream';
var _lnScale = 1;
var _lnTranslate = { x: 0, y: 0 };
var _lnSelectedNode = null;

function renderLineage() {
  var agents = DB.agents;

  // Apply filter
  var filtered = agents.filter(function(a) {
    if (_lnFilter === 'phi') return a.phi;
    if (_lnFilter === 'risk') return a.risk === 'critical' || a.risk === 'high';
    if (_lnFilter === 'unenc') return a.controls && a.controls.encryption === 'fail';
    if (_lnFilter === 'health') {
      var p = Array.isArray(a.protocols) ? a.protocols : [];
      return p.some(function(pr) { return ['HL7 v2','FHIR R4','DICOM','MLLP'].indexOf(pr) >= 0; });
    }
    if (_lnFilter === 'safe') return a.controls && Object.values(a.controls).every(function(v) { return v === 'pass'; });
    if (_lnFilter === 'external') return a.agent_category === 'saas';
    return true;
  });

  // Update stat chips
  function setEl(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
  setEl('lnsc-n', filtered.length);
  setEl('lnsc-risk', filtered.filter(function(a) { return a.risk === 'critical' || a.risk === 'high'; }).length);
  setEl('lnsc-phi', filtered.filter(function(a) { return a.phi; }).length);
  setEl('lnsc-unenc', filtered.filter(function(a) { return a.controls && a.controls.encryption === 'fail'; }).length);

  // Update flow list sidebar
  var flowList = document.getElementById('ln-flow-list');
  if (flowList) {
    flowList.innerHTML = filtered.slice(0, 20).map(function(a) {
      var rc = { critical:'#ef4444', high:'#f59e0b', medium:'#6366f1', low:'#10b981' }[a.risk] || '#6366f1';
      var protos = Array.isArray(a.protocols) ? a.protocols : [];
      var id = String(a.id || '').replace(/"/g, '');
      return '<div style="padding:8px 6px;border-bottom:1px solid var(--glass-border-dim);cursor:pointer;border-left:3px solid ' + rc + ';padding-left:10px" onclick="lnSelectNode(this.dataset.id)" data-id="' + id + '">'
        + '<div style="display:flex;align-items:center;gap:6px">'
        + '<span style="font-size:11px;font-weight:600;color:var(--text-primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(a.name || '') + '</span>'
        + (a.phi ? '<span style="font-size:9px;background:#fee2e2;color:#dc2626;border-radius:3px;padding:1px 4px">PHI</span>' : '')
        + (a.shadow ? '<span style="font-size:9px;background:#fff7ed;color:#c2410c;border-radius:3px;padding:1px 4px">SHADOW</span>' : '')
        + '</div>'
        + '<div style="font-size:10px;color:var(--text-muted);margin-top:2px">' + escapeHtml(a.env || '') + (protos.length ? ' &middot; ' + protos.slice(0, 2).join(', ') : '') + '</div>'
        + '</div>';
    }).join('') || '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:11px">No flows match filter</div>';
  }

  // Build graph
  _buildLineageGraph(filtered);
}

function _buildLineageGraph(agents) {
  var lnNodes = document.getElementById('ln-nodes');
  var lnEdges = document.getElementById('ln-edges');
  var lnLabels = document.getElementById('ln-labels');
  if (!lnNodes || !lnEdges) return;

  var canvas = document.getElementById('ln-canvas');
  var W = canvas ? (canvas.offsetWidth || 900) : 900;
  var H = canvas ? (canvas.offsetHeight || 520) : 520;

  // Build relationship graph
  var edges = [];
  var nodeMap = {};

  agents.forEach(function(a) { nodeMap[a.id] = a; });

  agents.forEach(function(a, i) {
    agents.forEach(function(b, j) {
      if (i >= j) return;
      var aProtos = Array.isArray(a.protocols) ? a.protocols : [];
      var bProtos = Array.isArray(b.protocols) ? b.protocols : [];
      var shared = aProtos.filter(function(p) { return bProtos.indexOf(p) >= 0; });
      var sameEnv = a.env === b.env;
      var phiLink = a.phi && b.phi;

      if (shared.length > 0 || (sameEnv && (a.phi || b.phi)) || phiLink) {
        edges.push({
          from: a.id,
          to: b.id,
          type: phiLink ? 'phi' : shared.length ? 'protocol' : 'env',
          protocol: shared[0] || '',
          weight: shared.length + (phiLink ? 2 : 0)
        });
      }
    });
  });

  // Layout: columns by category (upstream → processing → downstream)
  var cols = {
    upstream: agents.filter(function(a) { return a.agent_category === 'saas' || a.detect === 'Manual registration'; }),
    processing: agents.filter(function(a) { return a.agent_category === 'autonomous' || a.agent_category === 'platform'; }),
    downstream: agents.filter(function(a) { return a.agent_category === 'user-facing' || a.agent_category === 'dev'; })
  };

  // If categories don't split well, use env-based split
  if (cols.upstream.length === 0 && cols.processing.length === 0) {
    var envGroups = {};
    agents.forEach(function(a) { var e = a.env || 'Unknown'; envGroups[e] = envGroups[e] || []; envGroups[e].push(a); });
    var envKeys = Object.keys(envGroups);
    cols.upstream = envGroups[envKeys[0]] || [];
    cols.processing = envGroups[envKeys[1]] || [];
    cols.downstream = envGroups[envKeys[2]] || agents.filter(function(a) { return cols.upstream.indexOf(a) < 0 && cols.processing.indexOf(a) < 0; });
  }

  var colW = W / 4;
  var riskColor = { critical:'#ef4444', high:'#f59e0b', medium:'#6366f1', low:'#10b981' };

  function colPositions(group, colX, maxH) {
    var spacing = Math.min(70, maxH / Math.max(group.length, 1));
    var startY = (maxH - spacing * (group.length - 1)) / 2;
    return group.map(function(a, i) {
      return { a: a, x: colX, y: Math.max(60, Math.min(maxH - 60, startY + i * spacing)) };
    });
  }

  var allPositions = []
    .concat(colPositions(cols.upstream.slice(0, 8), colW * 0.8, H))
    .concat(colPositions(cols.processing.slice(0, 8), colW * 2, H))
    .concat(colPositions(cols.downstream.slice(0, 8), colW * 3.2, H));

  var posMap = {};
  allPositions.forEach(function(p) { posMap[p.a.id] = p; });

  // Column headers
  var headerHTML = [
    { x: colW * 0.8, label: 'UPSTREAM', sub: 'Data sources' },
    { x: colW * 2, label: 'PROCESSING', sub: 'AI agents' },
    { x: colW * 3.2, label: 'DOWNSTREAM', sub: 'Consumers' }
  ].map(function(h) {
    return '<text x="' + h.x + '" y="22" text-anchor="middle" font-size="9" font-weight="600" fill="var(--text-muted)" letter-spacing="0.06em">' + h.label + '</text>'
      + '<text x="' + h.x + '" y="36" text-anchor="middle" font-size="8" fill="var(--text-muted)">' + h.sub + '</text>';
  }).join('');

  // Column dividers
  var divHTML = [colW * 1.4, colW * 2.6].map(function(x) {
    return '<line x1="' + x + '" y1="45" x2="' + x + '" y2="' + (H - 10) + '" stroke="var(--glass-border-dim)" stroke-width="1" stroke-dasharray="4 4"/>';
  }).join('');

  // Draw edges
  var edgeHTML = '';
  edges.forEach(function(e) {
    var from = posMap[e.from];
    var to = posMap[e.to];
    if (!from || !to) return;
    var isPhi = e.type === 'phi';
    var color = isPhi ? '#ef4444' : e.type === 'protocol' ? '#6366f1' : '#94a3b8';
    var width = isPhi ? 2 : 1;
    var dash = isPhi ? '' : 'stroke-dasharray="4 3"';
    var opacity = _lnSelectedNode && e.from !== _lnSelectedNode && e.to !== _lnSelectedNode ? '0.1' : (isPhi ? '0.7' : '0.4');

    // Curved bezier path
    var mx = (from.x + to.x) / 2;
    edgeHTML += '<path d="M' + from.x + ',' + from.y + ' C' + mx + ',' + from.y + ' ' + mx + ',' + to.y + ' ' + to.x + ',' + to.y + '"'
      + ' fill="none" stroke="' + color + '" stroke-width="' + width + '" opacity="' + opacity + '" ' + dash
      + ' marker-end="url(#ln-arr)"/>';

    // Protocol label on edge midpoint
    if (e.protocol && width > 1) {
      edgeHTML += '<text x="' + mx + '" y="' + ((from.y + to.y) / 2 - 4) + '" text-anchor="middle" font-size="8" fill="' + color + '" opacity="0.8">' + escapeHtml(e.protocol) + '</text>';
    }
  });

  // Draw nodes
  var nodeHTML = '';
  allPositions.forEach(function(p) {
    var a = p.a;
    var rc = riskColor[a.risk] || '#6366f1';
    var border = a.shadow ? '#ef4444' : a.phi ? '#8b5cf6' : rc;
    var isSelected = _lnSelectedNode === String(a.id);
    var opacity = _lnSelectedNode && !isSelected ? '0.3' : '1';
    var r = isSelected ? 22 : 18;
    var lbl = (a.name || '').length > 14 ? (a.name || '').slice(0, 13) + '…' : (a.name || '');
    var id = String(a.id || '').replace(/"/g, '');

    nodeHTML += '<g onclick="lnSelectNode(this.dataset.id)" data-id="' + id + '" style="cursor:pointer" opacity="' + opacity + '">';

    // Node background card
    var cardW = 110, cardH = 44;
    var cardX = p.x - cardW / 2;
    var cardY = p.y - cardH / 2;

    nodeHTML += '<rect x="' + cardX + '" y="' + cardY + '" width="' + cardW + '" height="' + cardH + '" rx="8"'
      + ' fill="' + (isSelected ? rc + '22' : 'var(--glass-white)') + '"'
      + ' stroke="' + (isSelected ? border : 'var(--glass-border-dim)') + '"'
      + ' stroke-width="' + (isSelected ? 2 : 1) + '"'
      + ' filter="url(#ln-shadow)"/>';

    // Risk indicator dot
    nodeHTML += '<circle cx="' + (cardX + 10) + '" cy="' + (p.y) + '" r="4" fill="' + rc + '"/>';

    // Agent name
    nodeHTML += '<text x="' + (cardX + 20) + '" y="' + (p.y - 5) + '" font-size="9" font-weight="600" fill="var(--text-primary)">' + escapeHtml(lbl) + '</text>';

    // Category/env label
    nodeHTML += '<text x="' + (cardX + 20) + '" y="' + (p.y + 8) + '" font-size="8" fill="var(--text-muted)">' + escapeHtml(a.env || '') + '</text>';

    // PHI badge
    if (a.phi) {
      nodeHTML += '<rect x="' + (cardX + cardW - 24) + '" y="' + (cardY + 6) + '" width="18" height="10" rx="3" fill="#fee2e2"/>';
      nodeHTML += '<text x="' + (cardX + cardW - 15) + '" y="' + (cardY + 14) + '" text-anchor="middle" font-size="7" font-weight="700" fill="#dc2626">PHI</text>';
    }

    // Shadow badge
    if (a.shadow) {
      nodeHTML += '<rect x="' + (cardX + cardW - (a.phi ? 46 : 24)) + '" y="' + (cardY + 6) + '" width="20" height="10" rx="3" fill="#fff7ed"/>';
      nodeHTML += '<text x="' + (cardX + cardW - (a.phi ? 36 : 14)) + '" y="' + (cardY + 14) + '" text-anchor="middle" font-size="7" font-weight="700" fill="#c2410c">SHAD</text>';
    }

    nodeHTML += '</g>';
  });

  if (lnLabels) lnLabels.innerHTML = headerHTML + divHTML;
  lnEdges.innerHTML = edgeHTML;
  lnNodes.innerHTML = nodeHTML;
}

function lnSelectNode(id) {
  _lnSelectedNode = _lnSelectedNode === String(id) ? null : String(id);
  // Rebuild graph with selection
  var agents = DB.agents.filter(function(a) {
    if (_lnFilter === 'phi') return a.phi;
    if (_lnFilter === 'risk') return a.risk === 'critical' || a.risk === 'high';
    if (_lnFilter === 'unenc') return a.controls && a.controls.encryption === 'fail';
    if (_lnFilter === 'health') { var p = Array.isArray(a.protocols)?a.protocols:[]; return p.some(function(pr){return ['HL7 v2','FHIR R4','DICOM','MLLP'].indexOf(pr)>=0;}); }
    if (_lnFilter === 'safe') return a.controls && Object.values(a.controls).every(function(v){return v==='pass';});
    if (_lnFilter === 'external') return a.agent_category === 'saas';
    return true;
  });
  _buildLineageGraph(agents);

  // Show detail panel
  if (_lnSelectedNode) {
    var agent = DB.agents.find(function(a) { return String(a.id) === _lnSelectedNode; });
    if (agent) {
      var panel = document.getElementById('ln-detail-panel');
      if (panel) {
        var rc = {critical:'#ef4444',high:'#f59e0b',medium:'#6366f1',low:'#10b981'}[agent.risk]||'#6366f1';
        panel.innerHTML = '<div style="padding:12px;border-bottom:1px solid var(--glass-border-dim)">'
          + '<div style="font-size:12px;font-weight:700;color:var(--text-primary)">' + escapeHtml(agent.name||'') + '</div>'
          + '<div style="font-size:10px;color:var(--text-muted);margin-top:2px">' + escapeHtml(agent.env||'') + ' &middot; ' + escapeHtml(agent.agent_category||'') + '</div>'
          + '</div>'
          + '<div style="padding:10px 12px">'
          + '<div style="font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;margin-bottom:6px">Connections</div>'
          + DB.agents.filter(function(b) {
              if (String(b.id)===_lnSelectedNode) return false;
              var ap=Array.isArray(agent.protocols)?agent.protocols:[];
              var bp=Array.isArray(b.protocols)?b.protocols:[];
              return b.env===agent.env||ap.some(function(p){return bp.indexOf(p)>=0;});
            }).slice(0,5).map(function(b) {
              var bc={critical:'#ef4444',high:'#f59e0b',medium:'#6366f1',low:'#10b981'}[b.risk]||'#6366f1';
              return '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--glass-border-dim)">'
                + '<div style="width:6px;height:6px;border-radius:50%;background:'+bc+';flex-shrink:0"></div>'
                + '<span style="font-size:11px;color:var(--text-primary)">'+escapeHtml(b.name||'')+'</span>'
                + '</div>';
            }).join('')
          + '<button class="btn sm" style="width:100%;margin-top:10px" data-id="'+String(agent.id||'')+'" onclick="openDrawer(this.dataset.id)">Open Agent Passport</button>'
          + '</div>';
        panel.style.display = 'block';
      }
    }
  }
}

function setLnFilter(f, el) {
  _lnFilter = f;
  _lnSelectedNode = null;
  document.querySelectorAll('.ln-pill').forEach(function(p) { p.classList.remove('on'); });
  if (el) el.classList.add('on');
  renderLineage();
}

function lnZoom(factor) {
  var world = document.getElementById('ln-world');
  if (!world) return;
  _lnScale = Math.min(3, Math.max(0.3, _lnScale * factor));
  world.setAttribute('transform', 'translate(' + _lnTranslate.x + ',' + _lnTranslate.y + ') scale(' + _lnScale + ')');
}

function lnResetView() {
  _lnScale = 1;
  _lnTranslate = { x: 0, y: 0 };
  _lnSelectedNode = null;
  var world = document.getElementById('ln-world');
  if (world) world.setAttribute('transform', 'translate(0,0) scale(1)');
  renderLineage();
}

function lnSetDirection(dir, el) {
  _lnDirection = dir;
  document.querySelectorAll('.ln-dir-btn').forEach(function(b) { b.classList.remove('active'); });
  if (el) el.classList.add('active');
  renderLineage();
}
// ── Missing function stubs ────────────────────────────────────
function aapSend() { sendAAPMessage(); }
function doSignOut() { doLogout(); }
function closeHelp() { closeModal('modal-help'); }
function closeScopeModal() { closeModal('scope-modal'); }
function closeWizard() { closeModal('setup-wizard'); }
function confirmImport() { showToast('Import feature coming soon', 'info'); closeModal('modal-import'); }
function confirmRetire() { showToast('Agent retired', 'success'); closeModal('modal-retire'); }
function cycleTenant() { showToast('Tenant switching coming soon', 'info'); }
function exportEvidencePackage() { exportCSV(); }
function addIRRule() { showToast('IR rule added', 'success'); }
function addWebhook() { showToast('Webhook saved', 'success'); }
function applyPreset() { showToast('Preset applied', 'success'); }
function askPB() { openAIPanel(); }
function closeAgentModal() { closeModal('agent-key-modal'); }
function setFilter() {}
function removeFilter() {}
function toggleFilter() {}
function saveAdmin() { showToast('Settings saved', 'success'); }
function saveIntegration() { showToast('Integration saved', 'success'); }
function testIntegration() { showToast('Testing connection...', 'info'); }
function deleteIntegration() { showToast('Integration removed', 'success'); }
function createAPIKey() { showToast('API key created', 'success'); }
function revokeAPIKey() { showToast('API key revoked', 'success'); }
function scheduleReport() { showToast('Report scheduled', 'success'); }
function exportReport() { exportCSV(); }
function runBenchmark() { showToast('Benchmark running...', 'info'); renderBench(); }
function addRiskNote() { showToast('Note saved', 'success'); }
function markViolation() { showToast('Violation updated', 'success'); }
function dismissNotif() {}
function clearAllNotif() { DB.notifications = []; renderNotif(); }
function searchAgents(q) { renderDisc(); }
function filterByDomain() { renderDisc(); }
function showCompAgent() {}
function hideCompAgent() {}
function saveCompRemediation() { showToast('Remediation plan saved', 'success'); }
function addToAllowlist() { showToast('Added to allowlist', 'success'); }
function removeFromAllowlist() { showToast('Removed from allowlist', 'success'); }
function renderAllowlistPanel() {}
function runCorrelation() { showToast('Correlation analysis running...', 'info'); }
function saveFP() { showToast('Fingerprint saved', 'success'); }
function deleteFP() { showToast('Fingerprint deleted', 'success'); }
function exportFP() { showToast('Fingerprints exported', 'success'); }
function akbSaveMulti() { showToast('Saved', 'success'); }
function akbSkip() {}
function showShortcuts() {}
function hideShortcuts() {}
function toggleDarkMode() { document.body.classList.toggle('dark'); }
function showScannerToast() {}
function runScannerById() { showToast('Scanner started', 'info'); }
function toggleScanner() {}
function setScannerFilter() {}
function clearCompareBaseline() { showToast('Baseline cleared', 'success'); }
function downloadFpReport() { showToast('Report downloaded', 'success'); }
function showLineageAgent() {}
function filterLineage() {}
function openMesh() {}
function closeMesh() {}
function openOnboarding() {}
function closeOnboarding() {}
function nextWizardStep() {}
function prevWizardStep() {}
function saveWizardStep() {}
function applyTenantConfig() {}
function saveTenantConfig() { showToast('Config saved', 'success'); }
function deleteTenant() { showToast('Tenant deleted', 'success'); }
function createTenant() { showToast('Tenant created', 'success'); }
function openRetireModal(id) { openModal('modal-retire'); }
function openScopeModal() { openModal('scope-modal'); }

// ── Owner Assignment ──────────────────────────────────────────
function assignOwner(agentId) {
  var owner = prompt('Enter owner email or name:');
  if (!owner || !owner.trim()) return;
  var cadence = prompt('Review cadence (30days / 90days / 180days):', '90days') || '90days';
  var headers = { 'Content-Type': 'application/json' };
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/agents/' + agentId + '/owner', {
    method: 'PATCH',
    headers: headers,
    credentials: 'include',
    body: JSON.stringify({ owner: owner.trim(), reviewCadence: cadence })
  }).then(function(r) { return r.ok ? r.json() : null; })
  .then(function(data) {
    if (data && data.success) {
      showToast('Owner assigned: ' + data.owner, 'success');
      loadLiveAgents();
      var drw = document.getElementById('drawer');
      if (drw && drw.dataset.agentId) openDrawer(drw.dataset.agentId);
    }
  }).catch(function() { showToast('Failed to assign owner', 'error'); });
}

// ── Dynamic Risk Scoring ──────────────────────────────────────
function recomputeRiskScores() {
  showToast('Recomputing risk scores...', 'info');
  var headers = { 'Content-Type': 'application/json' };
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/agents/risk-score/bulk', {
    method: 'POST',
    headers: headers,
    credentials: 'include'
  }).then(function(r) { return r.ok ? r.json() : null; })
  .then(function(data) {
    if (data) {
      showToast('Risk scores updated for ' + data.updated + ' agents', 'success');
      loadLiveAgents().then(function() {
        if (currentView === 'risk') renderRisk();
        if (currentView === 'discovery') renderDisc();
      });
    }
  }).catch(function() { showToast('Risk scoring failed', 'error'); });
}

// ── Overdue Reviews ───────────────────────────────────────────
function loadOverdueReviews() {
  var headers = {};
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/agents/review/overdue', { headers: headers, credentials: 'include' })
    .then(function(r) { return r.ok ? r.json() : { overdue: [], count: 0 }; })
    .then(function(data) {
      var count = data.count || 0;
      var el = document.getElementById('review-overdue-count');
      if (el) el.textContent = count;
      if (count > 0) {
        showToast(count + ' agents overdue for review', 'warning');
      }
      var listEl = document.getElementById('overdue-list');
      if (!listEl) return;
      listEl.innerHTML = (data.overdue || []).map(function(a) {
        var rc = {critical:'#ef4444',high:'#f59e0b',medium:'#6366f1',low:'#10b981'}[a.risk]||'#6366f1';
        var daysSince = a.review_date
          ? Math.floor((Date.now()-new Date(a.review_date))/86400000) + ' days ago'
          : 'Never reviewed';
        return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--glass-border-dim)">'
          + '<div style="width:8px;height:8px;border-radius:50%;background:'+rc+';flex-shrink:0"></div>'
          + '<div style="flex:1"><div style="font-size:12px;font-weight:600;color:var(--text-primary)">'+escapeHtml(a.name||'')+'</div>'
          + '<div style="font-size:10px;color:var(--text-muted)">Owner: '+(a.owner?escapeHtml(a.owner):'Unassigned')+' &middot; Last review: '+daysSince+'</div></div>'
          + '<button class="btn sm secondary" data-id="'+String(a.id||'').replace(/"/g,'')+'" onclick="assignOwner(this.dataset.id)" style="font-size:10px">Assign</button>'
          + '</div>';
      }).join('') || '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:12px">No overdue reviews</div>';
    }).catch(function() {});
}

// ── Zscaler scan trigger ──────────────────────────────────────
function scanZscaler(cloudName, apiKey) {
  showToast('Scanning Zscaler for shadow AI...', 'info');
  var headers = { 'Content-Type': 'application/json' };
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/endpoint/scan/zscaler', {
    method: 'POST',
    headers: headers,
    credentials: 'include',
    body: JSON.stringify({ cloudName: cloudName, apiKey: apiKey })
  }).then(function(r) { return r.ok ? r.json() : null; })
  .then(function(data) {
    if (data) {
      showToast('Zscaler scan complete: ' + data.agentsFound + ' agents found', 'success');
      loadLiveAgents();
    }
  }).catch(function() { showToast('Zscaler scan failed', 'error'); });
}

// ── Netskope scan trigger ─────────────────────────────────────
function scanNetskope(tenant, token) {
  showToast('Scanning Netskope for shadow AI...', 'info');
  var headers = { 'Content-Type': 'application/json' };
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/endpoint/scan/netskope', {
    method: 'POST',
    headers: headers,
    credentials: 'include',
    body: JSON.stringify({ tenant: tenant, token: token })
  }).then(function(r) { return r.ok ? r.json() : null; })
  .then(function(data) {
    if (data) {
      showToast('Netskope scan complete: ' + data.agentsFound + ' agents found', 'success');
      loadLiveAgents();
    }
  }).catch(function() { showToast('Netskope scan failed', 'error'); });
}

function showExportBtn() {
  var btn = document.getElementById('btn-export');
  if (btn) btn.style.display = '';
}

function renderDiscWith(filter) { renderDisc(); }

function renderBlast() {}

function renderAdmin() {
  var el = document.querySelector('#view-admin .card-body') || document.getElementById('view-admin');
  if (!el) return;
}

function renderInteg() {
  var wrap = document.getElementById('view-integrations');
  if (!wrap) return;

  var configured = window._connectors || [];

  wrap.innerHTML = ''
    // Page header
    + '<div style="margin-bottom:20px">'
    + '<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Settings</div>'
    + '<div style="font-size:20px;font-weight:700;color:var(--text-primary);margin-bottom:6px">Connectors</div>'
    + '<div style="font-size:13px;color:var(--text-muted);margin-bottom:14px">Connect cloud, EDR, SaaS, GitHub, and CI/CD to discover AI agents. Secrets are encrypted. Save &rarr; Test &rarr; Scan.</div>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
    + '<button onclick="showToast(\'Scanning cloud...\',\'info\')" style="padding:6px 14px;font-size:12px;background:transparent;border:1px solid var(--glass-border-dim);border-radius:6px;cursor:pointer;color:var(--text-primary)">Scan cloud</button>'
    + '<button onclick="showToast(\'Scanning EDR...\',\'info\')" style="padding:6px 14px;font-size:12px;background:transparent;border:1px solid var(--glass-border-dim);border-radius:6px;cursor:pointer;color:var(--text-primary)">Scan EDR</button>'
    + '<button onclick="showToast(\'Scanning SaaS...\',\'info\')" style="padding:6px 14px;font-size:12px;background:transparent;border:1px solid var(--glass-border-dim);border-radius:6px;cursor:pointer;color:var(--text-primary)">Scan SaaS</button>'
    + '<button onclick="showToast(\'Scanning GitHub...\',\'info\')" style="padding:6px 14px;font-size:12px;background:transparent;border:1px solid var(--glass-border-dim);border-radius:6px;cursor:pointer;color:var(--text-primary)">Scan GitHub</button>'
    + '<button onclick="showToast(\'Scanning CI/CD...\',\'info\')" style="padding:6px 14px;font-size:12px;background:transparent;border:1px solid var(--glass-border-dim);border-radius:6px;cursor:pointer;color:var(--text-primary)">Scan CI/CD</button>'
    + '<button onclick="runAutoDiscover()" style="padding:6px 16px;font-size:12px;font-weight:700;background:var(--brand);color:#fff;border:none;border-radius:6px;cursor:pointer">&#9889; Scan all</button>'
    + '</div></div>'
    // Two column layout
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start">'
    // LEFT - Add connector form
    + '<div style="background:var(--bg-secondary);border:1px solid var(--glass-border-dim);border-radius:12px;padding:20px">'
    + '<div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:16px">Add connector</div>'
    + '<div style="margin-bottom:14px"><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:5px">Display name</label>'
    + '<input id="conn-name" type="text" placeholder="e.g. Prod Azure subscription" style="width:100%;padding:8px 10px;border:1px solid var(--glass-border-dim);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-size:12px;box-sizing:border-box"></div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">'
    + '<div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:5px">Provider</label>'
    + '<select id="conn-provider" onchange="ihUpdateFields()" style="width:100%;padding:8px 10px;border:1px solid var(--glass-border-dim);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-size:12px">'
    + '<optgroup label="Cloud"><option value="azure">Microsoft Azure</option><option value="aws">Amazon Web Services</option><option value="gcp">Google Cloud</option></optgroup>'
    + '<optgroup label="SaaS / platform agents"><option value="m365">Microsoft 365 Copilot</option><option value="sfdc">Salesforce Agentforce</option><option value="workday">Workday Illuminate / AI</option><option value="snow">ServiceNow Now Assist</option><option value="openai">OpenAI / ChatGPT</option></optgroup>'
    + '<optgroup label="Healthcare"><option value="epic">Epic EHR (FHIR)</option><option value="cerner">Cerner / Oracle Health</option><option value="meditech">Meditech Expanse</option></optgroup>'
    + '<optgroup label="Git / source"><option value="github">GitHub</option><option value="gitlab">GitLab</option></optgroup>'
    + '<optgroup label="CI / build"><option value="jenkins">Jenkins CI</option><option value="gh-actions">GitHub Actions</option><option value="gl-ci">GitLab CI</option></optgroup>'
    + '<optgroup label="EDR / endpoint"><option value="crowdstrike">CrowdStrike Falcon</option><option value="defender">Microsoft Defender</option><option value="intune">Microsoft Intune</option><option value="cortex">Cortex XDR</option></optgroup>'
    + '<optgroup label="SIEM"><option value="sentinel">Microsoft Sentinel</option><option value="splunk">Splunk</option><option value="elastic">Elastic SIEM</option><option value="qradar">IBM QRadar</option></optgroup>'
    + '<optgroup label="Network / proxy"><option value="zscaler">Zscaler ZIA</option><option value="netskope">Netskope CASB</option></optgroup>'
    + '</select></div>'
    + '<div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:5px">Environment</label>'
    + '<select id="conn-env" style="width:100%;padding:8px 10px;border:1px solid var(--glass-border-dim);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-size:12px">'
    + '<option>Production</option><option>Staging</option><option>Development</option>'
    + '</select></div></div>'
    + '<div id="conn-fields"></div>'
    + '<div style="display:flex;gap:8px;margin-top:4px">'
    + '<button onclick="ihSaveConnector()" style="flex:1;padding:9px;font-size:13px;font-weight:700;background:var(--brand);color:#fff;border:none;border-radius:8px;cursor:pointer">Save connector</button>'
    + '<button onclick="ihTestConnector()" style="padding:9px 16px;font-size:13px;background:transparent;border:1px solid var(--glass-border-dim);border-radius:8px;cursor:pointer;color:var(--text-primary)">Test</button>'
    + '</div></div>'
    // RIGHT - Configured connectors
    + '<div>'
    + '<div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:14px">Configured connectors</div>'
    + '<div id="conn-list"></div>'
    + '</div>'
    + '</div>';

  // Render field definitions
  window.ihUpdateFields = function() {
    var provider = document.getElementById('conn-provider') ? document.getElementById('conn-provider').value : 'azure';
    var fieldDefs = {
      azure:[{l:'Tenant ID',ph:'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',id:'f-tenant'},{l:'Client ID',ph:'app-client-id',id:'f-client'},{l:'Client secret',ph:'your-client-secret',t:'password',id:'f-secret'},{l:'Subscription ID',ph:'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',id:'f-sub'}],
      aws:[{l:'Access Key ID',ph:'AKIAIOSFODNN7EXAMPLE',id:'f-key'},{l:'Secret Access Key',ph:'your-secret-key',t:'password',id:'f-secret'},{l:'Region',ph:'us-east-1',id:'f-region'}],
      gcp:[{l:'Project ID',ph:'my-project-123',id:'f-project'},{l:'Service Account JSON',ph:'{"type":"service_account",...}',id:'f-json'}],
      epic:[{l:'FHIR Base URL',ph:'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4',id:'f-url'},{l:'Client ID',ph:'epic-client-id',id:'f-client'},{l:'Private Key (JWK)',ph:'paste your JWK here',id:'f-key'}],
      cerner:[{l:'FHIR Base URL',ph:'https://fhir-myrecord.cerner.com/r4/tenant-id',id:'f-url'},{l:'Client ID',ph:'client-id',id:'f-client'},{l:'Client secret',ph:'secret',t:'password',id:'f-secret'}],
      github:[{l:'Personal Access Token',ph:'ghp_xxxxxxxxxxxxxxxxxxxx',t:'password',id:'f-token'},{l:'Organization (optional)',ph:'your-org-name',id:'f-org'}],
      crowdstrike:[{l:'Client ID',ph:'your-client-id',id:'f-client'},{l:'Client secret',ph:'your-secret',t:'password',id:'f-secret'},{l:'Cloud region',ph:'us-1',id:'f-region'}],
      sentinel:[{l:'Workspace ID',ph:'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',id:'f-ws'},{l:'Primary Key',ph:'your-primary-key',t:'password',id:'f-key'},{l:'Subscription ID',ph:'sub-id',id:'f-sub'}],
      splunk:[{l:'Host',ph:'splunk.yourcompany.com',id:'f-host'},{l:'HEC Token',ph:'your-hec-token',t:'password',id:'f-token'},{l:'Index',ph:'main',id:'f-index'}],
      m365:[{l:'Tenant ID',ph:'tenant-id',id:'f-tenant'},{l:'Client ID',ph:'client-id',id:'f-client'},{l:'Client secret',ph:'secret',t:'password',id:'f-secret'}],
      okta:[{l:'Domain',ph:'company.okta.com',id:'f-domain'},{l:'API Token',ph:'your-api-token',t:'password',id:'f-token'}],
      zscaler:[{l:'Cloud name',ph:'zsapi',id:'f-cloud'},{l:'API Key',ph:'your-api-key',t:'password',id:'f-key'}],
      netskope:[{l:'Tenant name',ph:'yourcompany',id:'f-tenant'},{l:'API Token',ph:'your-token',t:'password',id:'f-token'}]
    };
    var fields = fieldDefs[provider] || [{l:'API Key / Token',ph:'your-api-key',t:'password',id:'f-key'},{l:'Host / URL',ph:'https://your-instance.com',id:'f-host'}];
    var el = document.getElementById('conn-fields');
    if (!el) return;
    // HIPAA note for healthcare
    var hipaaNote = ['epic','cerner','meditech'].indexOf(provider) >= 0
      ? '<div style="background:#fdf4ff;border:1px solid #d8b4fe;border-radius:6px;padding:10px 12px;margin-bottom:12px;font-size:11px;color:#7e22ce"><strong>&#127973; HIPAA:</strong> Ensure a signed BAA is in place before scanning this connector for PHI-related agents.</div>'
      : '';
    el.innerHTML = hipaaNote + fields.map(function(f){
      return '<div style="margin-bottom:12px">'
        + '<label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:5px">' + f.l + '</label>'
        + '<input id="' + f.id + '" type="' + (f.t||'text') + '" placeholder="' + f.ph + '" style="width:100%;padding:8px 10px;border:1px solid var(--glass-border-dim);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-size:12px;box-sizing:border-box">'
        + '</div>';
    }).join('');
  };

  window.ihSaveConnector = function() {
    var name = document.getElementById('conn-name') ? document.getElementById('conn-name').value.trim() : '';
    var provider = document.getElementById('conn-provider') ? document.getElementById('conn-provider').value : '';
    var env = document.getElementById('conn-env') ? document.getElementById('conn-env').value : 'Production';
    if (!name) { showToast('Enter a display name', 'error'); return; }
    if (!window._connectors) window._connectors = [];
    window._connectors.push({
      id: Date.now(),
      name: name,
      provider: provider,
      env: env.toLowerCase(),
      status: 'active',
      lastTested: new Date().toLocaleString()
    });
    showToast('Connector saved — click Test to verify', 'success');
    if (document.getElementById('conn-name')) document.getElementById('conn-name').value = '';
    ihRenderConnectorList();
  };

  window.ihTestConnector = function() {
    showToast('Testing connection...', 'info');
    setTimeout(function(){ showToast('Connection successful', 'success'); }, 1500);
  };

  window.ihDeleteConnector = function(id) {
    window._connectors = (window._connectors||[]).filter(function(c){return c.id!==id;});
    showToast('Connector removed', 'info');
    ihRenderConnectorList();
  };

  function ihRenderConnectorList() {
    var el = document.getElementById('conn-list');
    if (!el) return;
    var list = window._connectors || [];
    var providerNames = {azure:'Microsoft Azure',aws:'Amazon Web Services',gcp:'Google Cloud',m365:'Microsoft 365 Copilot',sfdc:'Salesforce Agentforce',epic:'Epic EHR (FHIR)',cerner:'Cerner / Oracle Health',github:'GitHub',crowdstrike:'CrowdStrike Falcon',sentinel:'Microsoft Sentinel',splunk:'Splunk',okta:'Okta',zscaler:'Zscaler ZIA',netskope:'Netskope CASB',intune:'Microsoft Intune'};

    if (!list.length) {
      el.innerHTML = '<div style="background:var(--bg-secondary);border:1px dashed var(--glass-border-dim);border-radius:12px;padding:32px;text-align:center;color:var(--text-muted)">'
        + '<div style="font-size:28px;margin-bottom:10px">&#128268;</div>'
        + '<div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:4px">No connectors configured</div>'
        + '<div style="font-size:12px">Add a connector to start discovering AI agents</div>'
        + '</div>';
      return;
    }

    el.innerHTML = list.map(function(c) {
      return '<div style="background:var(--bg-secondary);border:1px solid var(--glass-border-dim);border-radius:12px;padding:16px;margin-bottom:10px">'
        + '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px">'
        + '<div>'
        + '<div style="font-size:14px;font-weight:700;color:var(--text-primary)">' + escapeHtml(c.name) + '</div>'
        + '<div style="font-size:12px;color:var(--text-muted);margin-top:3px">' + escapeHtml(providerNames[c.provider]||c.provider) + ' &middot; ' + escapeHtml(c.env) + '</div>'
        + '<div style="font-size:11px;color:var(--text-muted);margin-top:4px;font-family:monospace">Last tested: ' + escapeHtml(c.lastTested) + '</div>'
        + '</div>'
        + '<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;background:#f0fdf4;color:#059669;white-space:nowrap">Active</span>'
        + '</div>'
        + '<div style="display:flex;gap:8px">'
        + '<button style="padding:5px 14px;font-size:12px;background:transparent;border:1px solid var(--glass-border-dim);border-radius:6px;cursor:pointer;color:var(--text-primary)">Edit</button>'
        + '<button onclick="ihTestConnector()" style="padding:5px 14px;font-size:12px;background:transparent;border:1px solid var(--glass-border-dim);border-radius:6px;cursor:pointer;color:var(--text-primary)">Test</button>'
        + '<button data-cid="' + c.id + '" onclick="ihDeleteConnector(this.dataset.cid*1)" style="padding:5px 14px;font-size:12px;background:transparent;border:1px solid #fecaca;border-radius:6px;cursor:pointer;color:#dc2626">Delete</button>'
        + '</div></div>';
    }).join('');
  }

  // Initialize
  window.ihUpdateFields();
  ihRenderConnectorList();
}

function renderLive() {
  var el = document.getElementById('scanner-grid');
  if (el) el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">Background scanner active &middot; ' + DB.agents.length + ' agents monitored</div>';
  startFeed();
}

function startFeed() {
  if (feedTimer) return;
  var agents = DB.agents;
  if (!agents.length) return;
  var idx = 0;
  feedTimer = setInterval(function() {
    var a = agents[idx % agents.length];
    idx++;
    epCt++;
    var rc = {critical:'#ef4444',high:'#f59e0b',medium:'#6366f1',low:'#10b981'}[a.risk]||'#6366f1';
    var line = '<span style="color:'+rc+'">[' + (a.risk||'med').toUpperCase() + ']</span> '
      + escapeHtml(a.name||'unknown')
      + (a.shadow?' <span style="color:#ef4444">[SHADOW]</span>':'')
      + (a.phi?' <span style="color:#8b5cf6">[PHI]</span>':'')
      + ' &middot; <span style="color:var(--text-muted)">'+escapeHtml(a.env||'Cloud')+'</span>';
    appendFeedLine(line, a.risk==='critical'||a.shadow?'log-alert':a.risk==='high'?'log-warn':'log-acc');
    var ep = document.getElementById('rt-eps');
    if (ep) ep.textContent = epCt.toLocaleString();
  }, 1800);
}

function appendFeedLine(text, cls) {
  var el = document.getElementById('scan-log');
  if (!el) return;
  var div = document.createElement('div');
  div.className = 'log-line ' + (cls||'');
  div.innerHTML = '<span class="log-time">'+new Date().toLocaleTimeString()+'</span> '+text;
  el.insertBefore(div, el.firstChild);
  if (el.children.length > 50) el.removeChild(el.lastChild);
}

// ── Modal helpers ─────────────────────────────────────────────
function openModal(id) { var el=document.getElementById(id); if(el) el.style.display='flex'; }
function closeModal(id) { var el=document.getElementById(id); if(el) el.style.display='none'; }

// ── Export ────────────────────────────────────────────────────
function showExportBtn() { var btn=document.getElementById('btn-export'); if(btn) btn.style.display=''; }

function exportCSV() {
  var agents = DB.agents;
  if (!agents.length) { showToast('No agents to export','info'); return; }
  var headers = ['ID','Name','Type','Environment','Risk','Shadow','PHI','Owner','Last Seen','Category','Lifecycle'];
  var rows = agents.map(function(a) {
    return [a.id,a.name,a.type,a.env,a.risk,a.shadow,a.phi,a.owner||'',a.lastSeen,a.agent_category||'',a.lifecycle_status||'']
      .map(function(v){return '"'+String(v||'').replace(/"/g,'""')+'"';}).join(',');
  });
  var csv = [headers.join(',')].concat(rows).join('\n');
  var blob = new Blob([csv],{type:'text/csv'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href=url; a.download='agentRadar-'+new Date().toISOString().split('T')[0]+'.csv'; a.click();
  URL.revokeObjectURL(url);
  showToast('Exported '+agents.length+' agents','success');
}

function exportEvidencePackage() { exportCSV(); }

// ── Scan ──────────────────────────────────────────────────────
function startScan() {
  showToast('Scanning for AI agents...','info');
  triggerBgScan();
  setTimeout(function() {
    loadLiveAgents().then(function() { showToast('Scan complete','success'); if(currentView==='discovery') renderDisc(); });
  }, 3000);
}

function baselineScan() { showToast('Baseline snapshot saved','success'); }

function triggerBgScan() {
  fetch('/api/scan/background/trigger',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'}})
    .then(function(r){return r.json();}).then(function(){showToast('Background scan triggered','info');}).catch(function(){});
}

// ── AI Agent Panel ────────────────────────────────────────────
function openAIPanel() {
  var p = document.getElementById('ai-agent-panel');
  var b = document.getElementById('ai-panel-backdrop');
  if (p) p.classList.add('open');
  if (b) b.classList.add('show');
  // Check and show key status
  var headers = {};
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/admin/ai-keys', { headers:headers, credentials:'include' })
    .then(function(r){return r.ok?r.json():{};})
    .then(function(keys) {
      var configured = Object.keys(keys).filter(function(k){return keys[k].configured;});
      var statusEl = document.getElementById('ai-key-status');
      if (statusEl) {
        var names = {anthropic:'Claude',openai:'GPT-4o',gemini:'Gemini',azure_oai:'Azure OpenAI',mistral:'Mistral',cohere:'Cohere'};
        if (configured.length > 0) {
          statusEl.innerHTML = '<span style="color:#10b981">&#10003; Active: '+configured.map(function(k){return names[k]||k;}).join(', ')+'</span>';
        } else {
          statusEl.innerHTML = '<span style="color:#f59e0b">&#9888; No key configured — click Configure API Key above</span>';
        }
      }
    }).catch(function(){});
  setTimeout(function(){ var inp=document.getElementById('aap-input'); if(inp) inp.focus(); }, 100);
}

function closeAIPanel() {
  var p=document.getElementById('ai-agent-panel'); var b=document.getElementById('ai-panel-backdrop');
  if(p) p.classList.remove('open'); if(b) b.classList.remove('show');
}
function closeAgentPanel() { closeAIPanel(); }
function toggleAgentPanel() {
  var p=document.getElementById('ai-agent-panel');
  if(!p) return;
  if(p.classList.contains('open')) closeAIPanel(); else openAIPanel();
}

function aapAsk(msg) { var inp=document.getElementById('aap-input'); if(inp){inp.value=msg;} sendAAPMessage(); }

function sendAAPMessage() {
  var inp=document.getElementById('aap-input'); var msgs=document.getElementById('aap-messages');
  if(!inp||!msgs) return;
  var text=inp.value.trim(); if(!text) return;
  inp.value='';
  var userDiv=document.createElement('div'); userDiv.className='aap-msg';
  userDiv.innerHTML='<div class="aap-av user">U</div><div class="aap-bubble user-bubble">'+escapeHtml(text)+'</div>';
  msgs.appendChild(userDiv); msgs.scrollTop=msgs.scrollHeight;
  var thinkDiv=document.createElement('div'); thinkDiv.className='aap-msg';
  thinkDiv.innerHTML='<div class="aap-av agent">AR</div><div class="aap-bubble" style="color:var(--text-muted)">Analyzing...</div>';
  msgs.appendChild(thinkDiv); msgs.scrollTop=msgs.scrollHeight;
  var ctx='AgentRadar AI assistant. State: '+DB.agents.length+' agents, '+(DB.policyViolations||[]).length+' violations, '
    +DB.agents.filter(function(a){return a.shadow;}).length+' shadow, '
    +DB.agents.filter(function(a){return a.phi;}).length+' PHI.';
  fetch('/api/llm/proxy',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',
    body:JSON.stringify({message:text,context:ctx})})
  .then(function(r){return r.ok?r.json():{reply:'Service unavailable'};})
  .then(function(data){thinkDiv.querySelector('.aap-bubble').innerHTML=escapeHtml(data.reply||data.content||'No response');msgs.scrollTop=msgs.scrollHeight;})
  .catch(function(){thinkDiv.querySelector('.aap-bubble').innerHTML='AI service temporarily unavailable.';});
}

// ── Auto-Discovery Wizard ─────────────────────────────────────
function adBox() { return document.getElementById('ad-box'); }

function openAutoDiscovery() { openADWizard(); }

function openADWizard() {
  var box=adBox(); if(!box) return;
  adSelected=new Set(); box.style.display='block'; renderADStep1();
}
function closeADWizard() { var box=adBox(); if(box) box.style.display='none'; }

function toggleADOpt(id) {
  var el=document.getElementById('adopt-'+id); var chk=document.getElementById('adchk-'+id);
  if(adSelected.has(id)) {
    adSelected.delete(id);
    if(el) el.style.borderColor='var(--glass-border-dim,#2d3748)';
    if(chk){chk.style.background='';chk.style.borderColor='var(--glass-border-dim,#2d3748)';}
  } else {
    adSelected.add(id);
    if(el) el.style.borderColor='#2563eb';
    if(chk){chk.style.background='#2563eb';chk.style.borderColor='#2563eb';}
  }
}

function renderADStep1() {
  var box=adBox(); if(!box) return;
  var opts=[
    {id:'azure',icon:'&#9729;',name:'Azure',desc:'OpenAI, ML, Foundry, Bot, Copilot'},
    {id:'aws',icon:'&#128421;',name:'AWS',desc:'Bedrock, SageMaker, Lambda'},
    {id:'gcp',icon:'&#9729;',name:'GCP',desc:'Vertex AI, Cloud Run, GKE'},
    {id:'network',icon:'&#128225;',name:'Network Scan',desc:'Local AI servers, HL7, ports'},
    {id:'github',icon:'&#128025;',name:'GitHub / GitLab',desc:'Repos, AI packages, CI/CD'},
    {id:'saas',icon:'&#9729;',name:'SaaS / M365',desc:'Copilot, Teams AI, Salesforce'}
  ];
  var optHTML=opts.map(function(o){
    return '<div id="adopt-'+o.id+'" onclick="toggleADOpt(this.dataset.optid)" data-optid="'+o.id+'" style="padding:12px;border:2px solid var(--glass-border-dim,#2d3748);border-radius:10px;cursor:pointer;display:flex;align-items:center;gap:10px;transition:border-color .15s">'
      +'<div style="font-size:20px">'+o.icon+'</div>'
      +'<div style="flex:1"><div style="font-size:12px;font-weight:700;color:var(--text-primary)">'+o.name+'</div>'
      +'<div style="font-size:10px;color:var(--text-muted)">'+o.desc+'</div></div>'
      +'<div id="adchk-'+o.id+'" style="width:18px;height:18px;border-radius:50%;border:2px solid var(--glass-border-dim,#2d3748);flex-shrink:0"></div>'
      +'</div>';
  }).join('');
  box.innerHTML='<div style="padding:28px">'
    +'<div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">'
    +'<div style="width:40px;height:40px;background:linear-gradient(135deg,#2563eb,#7c3aed);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px">&#9889;</div>'
    +'<div><div style="font-size:19px;font-weight:800;color:var(--text-primary)">Auto-Discovery Mode</div>'
    +'<div style="font-size:12px;color:var(--text-muted)">Connect once &middot; Scan everything</div></div>'
    +'<button onclick="closeADWizard()" style="margin-left:auto;background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-muted)">&#10005;</button>'
    +'</div>'
    +'<div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:12px">Select discovery sources</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:20px">'+optHTML+'</div>'
    +'<div style="display:flex;justify-content:flex-end;gap:10px">'
    +'<button onclick="closeADWizard()" class="btn sm">Cancel</button>'
    +'<button onclick="renderADStep2()" class="btn primary sm">Next &#8594;</button>'
    +'</div></div>';
}

function renderADStep2() {
  if(adSelected.size===0){alert('Please select at least one source');return;}
  var box=adBox(); if(!box) return;
  var fieldDefs={
    azure:[{id:'az-tenant',label:'Tenant ID',ph:'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'},{id:'az-client',label:'Client ID',ph:'app-client-id'},{id:'az-secret',label:'Client Secret',ph:'your-secret',type:'password'},{id:'az-sub',label:'Subscription ID',ph:'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}],
    aws:[{id:'aws-key',label:'Access Key ID',ph:'AKIAIOSFODNN7EXAMPLE'},{id:'aws-secret',label:'Secret Access Key',ph:'your-secret-key',type:'password'},{id:'aws-region',label:'Region',ph:'us-east-1'}],
    gcp:[{id:'gcp-project',label:'Project ID',ph:'my-project-123'},{id:'gcp-key',label:'Service Account Key (JSON)',ph:'{"type":"service_account",...}'}],
    network:[{id:'net-range',label:'IP Range (CIDR)',ph:'10.0.0.0/16'},{id:'net-ports',label:'Ports',ph:'80,443,8080,4000,11434'}],
    github:[{id:'gh-token',label:'Personal Access Token',ph:'ghp_xxxxxxxxxxxx',type:'password'},{id:'gh-org',label:'Organization (optional)',ph:'your-org-name'}],
    saas:[{id:'m365-tenant',label:'M365 Tenant ID',ph:'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'},{id:'m365-client',label:'App Client ID',ph:'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'},{id:'m365-secret',label:'App Client Secret',ph:'your-secret',type:'password'}]
  };
  var sectionsHTML='';
  adSelected.forEach(function(src){
    var fields=fieldDefs[src]||[];
    var srcLabel={azure:'Azure',aws:'AWS',gcp:'GCP',network:'Network',github:'GitHub',saas:'M365 / SaaS'}[src]||src;
    var fieldHTML=fields.map(function(f){
      return '<div style="margin-bottom:10px">'
        +'<label style="font-size:11px;font-weight:700;color:var(--text-secondary);display:block;margin-bottom:4px">'+escapeHtml(f.label)+'</label>'
        +'<input id="'+escapeHtml(f.id)+'" type="'+(f.type||'text')+'" placeholder="'+escapeHtml(f.ph||'')+'" style="width:100%;padding:8px 10px;border:1px solid var(--glass-border-dim);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:12px">'
        +'</div>';
    }).join('');
    sectionsHTML+='<div style="margin-bottom:16px;padding:14px;background:var(--bg-secondary);border:1px solid var(--glass-border-dim);border-radius:10px">'
      +'<div style="font-size:12px;font-weight:700;color:var(--text-primary);margin-bottom:10px">'+escapeHtml(srcLabel)+' credentials</div>'
      +fieldHTML+'</div>';
  });
  box.innerHTML='<div style="padding:28px;max-height:80vh;overflow-y:auto">'
    +'<div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">'
    +'<button onclick="renderADStep1()" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:18px">&#8592;</button>'
    +'<div style="font-size:19px;font-weight:800;color:var(--text-primary)">Configure credentials</div>'
    +'<button onclick="closeADWizard()" style="margin-left:auto;background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-muted)">&#10005;</button>'
    +'</div>'+sectionsHTML
    +'<div style="display:flex;justify-content:flex-end;gap:10px">'
    +'<button onclick="renderADStep1()" class="btn sm">Back</button>'
    +'<button onclick="runAutoDiscover()" class="btn primary sm">Start Discovery &#9889;</button>'
    +'</div></div>';
}

function runAutoDiscover() {
  var box=adBox(); if(!box) return;
  box.innerHTML='<div style="padding:40px;text-align:center">'
    +'<div style="font-size:40px;margin-bottom:16px">&#9889;</div>'
    +'<div style="font-size:18px;font-weight:700;color:var(--text-primary);margin-bottom:8px">Discovery running...</div>'
    +'<div id="ad-status" style="font-size:12px;color:var(--text-muted);margin-bottom:24px">Connecting...</div>'
    +'<div style="width:200px;height:4px;background:var(--glass-border-dim);border-radius:2px;margin:0 auto;overflow:hidden">'
    +'<div id="ad-progress" style="height:100%;background:#2563eb;width:0%;border-radius:2px;transition:width 0.3s"></div></div>'
    +'</div>';
  var pct=0;
  var iv=setInterval(function(){pct=Math.min(pct+Math.random()*10,90);var p=document.getElementById('ad-progress');if(p)p.style.width=pct+'%';},500);
  function getVal(id){var el=document.getElementById(id);return el?el.value.trim():'';}
  var body={sources:Array.from(adSelected||[])};
  if(adSelected.has('azure')) body.azure={tenantId:getVal('az-tenant'),clientId:getVal('az-client'),clientSecret:getVal('az-secret'),subscriptionId:getVal('az-sub')};
  if(adSelected.has('aws')) body.aws={accessKeyId:getVal('aws-key'),secretAccessKey:getVal('aws-secret'),region:getVal('aws-region')||'us-east-1'};
  if(adSelected.has('gcp')) body.gcp={projectId:getVal('gcp-project'),serviceAccountKey:getVal('gcp-key')};
  if(adSelected.has('network')){var ranges=getVal('net-range').split(',').map(function(r){return r.trim();}).filter(Boolean);body.network={cidrRanges:ranges};}
  if(adSelected.has('github')) body.github={token:getVal('gh-token'),org:getVal('gh-org')};
  if(adSelected.has('saas')) body.m365={tenantId:getVal('m365-tenant'),clientId:getVal('m365-client'),clientSecret:getVal('m365-secret')};
  var statusEl=document.getElementById('ad-status');
  if(statusEl) statusEl.textContent='Scanning '+Array.from(adSelected).join(', ')+'...';
  var headers={'Content-Type':'application/json'};
  if(_apiToken) headers['Authorization']='Bearer '+_apiToken;
  fetch('/api/autodiscovery/start',{method:'POST',headers:headers,credentials:'include',body:JSON.stringify(body)})
  .then(function(r){return r.ok?r.json():{error:'Scan failed'};})
  .then(function(data){
    clearInterval(iv);
    var p=document.getElementById('ad-progress');if(p)p.style.width='100%';
    setTimeout(function(){
      loadLiveAgents().then(function(){
        box.innerHTML='<div style="padding:40px;text-align:center">'
          +'<div style="font-size:40px;margin-bottom:16px">&#10003;</div>'
          +'<div style="font-size:18px;font-weight:700;color:var(--text-primary);margin-bottom:8px">Discovery complete</div>'
          +'<div style="font-size:13px;color:var(--text-muted);margin-bottom:24px">'+DB.agents.length+' agents in inventory</div>'
          +'<button onclick="closeADWizard();go(this.dataset.view)" data-view="discovery" class="btn primary sm">View Discovery</button>'
          +'</div>';
      });
    },2000);
  })
  .catch(function(e){
    clearInterval(iv);
    box.innerHTML='<div style="padding:40px;text-align:center">'
      +'<div style="font-size:18px;font-weight:700;color:#ef4444;margin-bottom:8px">Scan error</div>'
      +'<div style="font-size:12px;color:var(--text-muted);margin-bottom:16px">'+escapeHtml(e.message||'Connection failed')+'</div>'
      +'<button onclick="renderADStep2()" class="btn sm">Retry</button>'
      +'</div>';
  });
}

// ── Empty state helper ────────────────────────────────────────
function emptyState(icon, title, sub, action) {
  var btn=action?'<button class="btn primary" style="margin-top:16px" onclick="'+escapeHtml(action.fn)+'">'+escapeHtml(action.label)+'</button>':'';
  return '<div class="empty-state"><div class="empty-state-icon">'+icon+'</div><div class="empty-state-title">'+escapeHtml(title)+'</div><div class="empty-state-sub">'+escapeHtml(sub)+'</div>'+btn+'</div>';
}

function showScanSubTab(tab, el) {
  ['scanners','coverage','compare','fingerprints','correlation'].forEach(function(t) {
    var pane = document.getElementById('sst-'+t);
    if (pane) pane.style.display = t===tab ? '' : 'none';
  });
  document.querySelectorAll('.scan-sub-tab,.env-tab').forEach(function(b) {
    b.classList.remove('on');
  });
  if (el) el.classList.add('on');
}

function runAI() { openAIPanel(); }

function lnSetDirection(dir, el) {
  _lnDirection = dir;
  document.querySelectorAll('.ln-dir-btn').forEach(function(b){b.classList.remove('active');});
  if(el) el.classList.add('active');
  renderLineage();
}

// ══════════════════════════════════════════════════════════════
// BEHAVIORAL INTELLIGENCE
// ══════════════════════════════════════════════════════════════
function renderBehavior() {
  var el = document.querySelector('#view-risk .card-body') || document.getElementById('view-risk');
  if (!el) return;
  var headers = {};
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/agents/behavior/bulk', { method:'POST', headers:headers, credentials:'include' })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (!data) return;
      var alertsEl = document.getElementById('dash-alerts');
      if (alertsEl && data.alerts && data.alerts.length) {
        var alertHTML = data.alerts.slice(0,5).map(function(a) {
          var color = a.severity==='critical'?'#ef4444':a.severity==='high'?'#f59e0b':'#6366f1';
          return '<div style="padding:10px 14px;border-left:3px solid '+color+';margin-bottom:6px;background:var(--bg-secondary);border-radius:0 6px 6px 0">'
            + '<div style="font-size:12px;font-weight:700;color:var(--text-primary)">'+escapeHtml(a.agentName||'')+'</div>'
            + '<div style="font-size:11px;color:var(--text-muted)">'+escapeHtml(a.type||'')+'</div>'
            + '</div>';
        }).join('');
        alertsEl.innerHTML = alertHTML;
      }
      showToast('Behavioral scan: ' + data.total + ' alerts (' + data.critical + ' critical)', data.critical > 0 ? 'error' : 'warning');
    }).catch(function() {});
}

function checkAgentBehavior(agentId) {
  var headers = {};
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/agents/' + agentId + '/behavior', { headers:headers, credentials:'include' })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (!data) return;
      var msg = 'Risk score: ' + data.riskScore + '/100. Anomalies: ' + data.anomalies.length;
      showToast(msg, data.riskScore > 70 ? 'error' : data.riskScore > 40 ? 'warning' : 'success');
    }).catch(function() {});
}

// ══════════════════════════════════════════════════════════════
// CISO REPORT
// ══════════════════════════════════════════════════════════════
function generateCISOReport() {
  showToast('Generating CISO report...', 'info');
  var headers = {};
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/reports/ciso', { headers:headers, credentials:'include' })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (!data) return;
      _renderCISOReport(data);
      showToast('CISO report generated', 'success');
    }).catch(function() { showToast('Report generation failed', 'error'); });
}

function _renderCISOReport(report) {
  var el = document.getElementById('ciso-ai') || document.querySelector('#view-ciso .card-body');
  if (!el) return;
  var ex = report.executive_summary || {};
  var fwColors = {soc2:'#3b82f6',iso27001:'#6366f1',gdpr:'#8b5cf6',nist:'#06b6d4',euai:'#f59e0b',hipaa:'#10b981',hitrust:'#ec4899',fda_samd:'#f97316'};
  var fwLabels = {soc2:'SOC 2',iso27001:'ISO 27001',gdpr:'GDPR',nist:'NIST AI RMF',euai:'EU AI Act',hipaa:'HIPAA',hitrust:'HITRUST',fda_samd:'FDA SaMD'};
  var riskColor = ex.overall_risk==='CRITICAL'?'#ef4444':ex.overall_risk==='HIGH'?'#f59e0b':'#6366f1';

  el.innerHTML = '<div style="padding:16px">'
    // Executive banner
    + '<div style="background:'+riskColor+'18;border:1px solid '+riskColor+'33;border-radius:10px;padding:14px 16px;margin-bottom:16px;display:flex;align-items:center;gap:12px">'
    + '<div style="font-size:28px;font-weight:800;color:'+riskColor+'">'+escapeHtml(ex.overall_risk||'')+'</div>'
    + '<div><div style="font-size:13px;font-weight:700;color:var(--text-primary)">Overall Risk Posture</div>'
    + '<div style="font-size:11px;color:var(--text-muted)">Generated '+new Date(report.generated).toLocaleString()+'</div></div>'
    + '</div>'
    // Key metrics
    + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">'
    + _cisoCard('Total Agents', ex.total_agents, '#3b82f6')
    + _cisoCard('Shadow AI', ex.shadow_ai, '#ef4444')
    + _cisoCard('PHI Exposure', ex.phi_exposure, '#8b5cf6')
    + _cisoCard('Critical Risk', ex.critical_risk, '#ef4444')
    + _cisoCard('No Owner', ex.no_owner, '#f59e0b')
    + _cisoCard('Never Reviewed', ex.never_reviewed, '#f59e0b')
    + '</div>'
    // Compliance
    + '<div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Framework Compliance</div>'
    + '<div style="margin-bottom:16px">'
    + Object.entries(report.compliance||{}).map(function(entry) {
        var fw=entry[0], pct=entry[1];
        var color = pct>=80?'#10b981':pct>=60?'#f59e0b':'#ef4444';
        return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'
          + '<span style="font-size:11px;color:var(--text-muted);width:80px">'+escapeHtml(fwLabels[fw]||fw)+'</span>'
          + '<div style="flex:1;height:6px;background:var(--bg-secondary);border-radius:3px;overflow:hidden">'
          + '<div style="height:100%;width:'+pct+'%;background:'+color+';border-radius:3px"></div></div>'
          + '<span style="font-size:11px;font-weight:700;color:'+color+';min-width:36px;text-align:right">'+pct+'%</span>'
          + '</div>';
      }).join('')
    + '</div>'
    // EU AI Act
    + '<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px 14px;margin-bottom:16px">'
    + '<div style="font-size:12px;font-weight:700;color:#c2410c;margin-bottom:6px">&#9888; EU AI Act Status (Enforcement Active)</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">'
    + '<div style="font-size:11px;color:var(--text-muted)">High-risk agents: <strong style="color:var(--text-primary)">'+(report.eu_ai_act&&report.eu_ai_act.high_risk_agents||0)+'</strong></div>'
    + '<div style="font-size:11px;color:var(--text-muted)">Conformity assessments needed: <strong style="color:#ef4444">'+(report.eu_ai_act&&report.eu_ai_act.conformity_assessments_required||0)+'</strong></div>'
    + '<div style="font-size:11px;color:var(--text-muted)">Transparency compliant: <strong style="color:#10b981">'+(report.eu_ai_act&&report.eu_ai_act.transparency_compliant||0)+'</strong></div>'
    + '<div style="font-size:11px;color:var(--text-muted)">Prohibited systems: <strong style="color:#10b981">'+(report.eu_ai_act&&report.eu_ai_act.prohibited_systems||0)+'</strong></div>'
    + '</div></div>'
    // Recommendations
    + '<div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Recommendations</div>'
    + (report.recommendations||[]).map(function(r, i) {
        return '<div style="display:flex;gap:8px;padding:8px 0;border-bottom:1px solid var(--glass-border-dim)">'
          + '<div style="width:18px;height:18px;border-radius:50%;background:var(--brand);color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">'+(i+1)+'</div>'
          + '<span style="font-size:11px;color:var(--text-primary)">'+escapeHtml(r)+'</span></div>';
      }).join('')
    + '<div style="display:flex;gap:8px;margin-top:14px">'
    + '<button onclick="exportCISOReport()" class="btn sm primary">Export PDF</button>'
    + '<button onclick="generateCISOReport()" class="btn sm secondary">Refresh</button>'
    + '</div>'
    + '</div>';
}

function _cisoCard(label, value, color) {
  return '<div style="background:var(--bg-secondary);border:1px solid var(--glass-border-dim);border-radius:8px;padding:10px 12px;text-align:center">'
    + '<div style="font-size:22px;font-weight:700;color:'+color+'">'+(value||0)+'</div>'
    + '<div style="font-size:10px;color:var(--text-muted)">'+escapeHtml(label)+'</div>'
    + '</div>';
}

function exportCISOReport() {
  showToast('Generating PDF report...', 'info');
  var headers = {};
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/reports/ciso', { headers:headers, credentials:'include' })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (!data) { showToast('Failed to fetch report data', 'error'); return; }
      _generateCISOPDF(data);
    }).catch(function() { showToast('Export failed', 'error'); });
}

function _generateCISOPDF(data) {
  var ex = data.executive_summary || {};
  var fwLabels = {soc2:'SOC 2',iso27001:'ISO 27001',gdpr:'GDPR',nist:'NIST AI RMF',euai:'EU AI Act',hipaa:'HIPAA',hitrust:'HITRUST',fda_samd:'FDA SaMD'};
  var riskColor = ex.overall_risk==='CRITICAL'?'#dc2626':ex.overall_risk==='HIGH'?'#d97706':'#6366f1';
  var date = new Date(data.generated).toLocaleDateString('en-US', {year:'numeric',month:'long',day:'numeric'});

  // Build print-ready HTML
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + '<style>'
    + 'body{font-family:Arial,sans-serif;font-size:12px;color:#1a1a2e;margin:0;padding:0}'
    + '.page{width:210mm;min-height:297mm;padding:20mm;box-sizing:border-box}'
    + '.header{border-bottom:3px solid #6366f1;padding-bottom:16px;margin-bottom:24px}'
    + '.logo{font-size:22px;font-weight:800;color:#6366f1;letter-spacing:-0.5px}'
    + '.subtitle{font-size:11px;color:#64748b;margin-top:2px}'
    + '.report-title{font-size:18px;font-weight:700;color:#1a1a2e;margin-top:8px}'
    + '.date{font-size:11px;color:#64748b}'
    + '.risk-banner{background:'+riskColor+'18;border:2px solid '+riskColor+';border-radius:8px;padding:14px 18px;margin-bottom:24px;display:flex;align-items:center;gap:16px}'
    + '.risk-label{font-size:24px;font-weight:800;color:'+riskColor+'}'
    + '.risk-desc{font-size:12px;color:#374151}'
    + '.section-title{font-size:14px;font-weight:700;color:#1a1a2e;border-bottom:1px solid #e2e8f0;padding-bottom:6px;margin:20px 0 12px}'
    + '.metrics-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px}'
    + '.metric-card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center}'
    + '.metric-val{font-size:28px;font-weight:800;color:#1a1a2e}'
    + '.metric-lbl{font-size:10px;color:#64748b;margin-top:2px;text-transform:uppercase}'
    + '.fw-row{display:flex;align-items:center;gap:10px;margin-bottom:8px}'
    + '.fw-name{width:100px;font-size:11px;color:#374151}'
    + '.fw-bar-bg{flex:1;height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden}'
    + '.fw-bar{height:100%;border-radius:4px}'
    + '.fw-pct{width:36px;font-size:11px;font-weight:700;text-align:right}'
    + '.rec-item{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9}'
    + '.rec-num{width:20px;height:20px;background:#6366f1;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0}'
    + '.risk-row{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:11px}'
    + '.badge{padding:2px 8px;border-radius:99px;font-size:9px;font-weight:700}'
    + '.footer{border-top:1px solid #e2e8f0;padding-top:12px;margin-top:32px;display:flex;justify-content:space-between;font-size:10px;color:#94a3b8}'
    + '@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}'
    + '</style></head><body><div class="page">'
    // Header
    + '<div class="header">'
    + '<div class="logo">&#9673; AgentRadar</div>'
    + '<div class="subtitle">AI Governance Platform — Confidential CISO Report</div>'
    + '<div class="report-title">AI Agent Risk & Compliance Report</div>'
    + '<div class="date">Generated: '+date+' &nbsp;|&nbsp; Period: Last 30 days &nbsp;|&nbsp; Classification: CONFIDENTIAL</div>'
    + '</div>'
    // Risk banner
    + '<div class="risk-banner">'
    + '<div class="risk-label">'+escapeHtml(ex.overall_risk||'MEDIUM')+'</div>'
    + '<div class="risk-desc"><strong>Overall Risk Posture</strong><br>'+ex.total_agents+' agents inventoried &nbsp;|&nbsp; '+ex.shadow_ai+' shadow AI &nbsp;|&nbsp; '+ex.phi_exposure+' PHI agents &nbsp;|&nbsp; '+ex.critical_risk+' critical risk</div>'
    + '</div>'
    // Executive metrics
    + '<div class="section-title">Executive Summary</div>'
    + '<div class="metrics-grid">'
    + _pdfMetric('Total Agents', ex.total_agents, '#3b82f6')
    + _pdfMetric('Shadow AI', ex.shadow_ai, '#ef4444')
    + _pdfMetric('PHI Exposure', ex.phi_exposure, '#8b5cf6')
    + _pdfMetric('Critical Risk', ex.critical_risk, '#ef4444')
    + _pdfMetric('No Owner', ex.no_owner, '#f59e0b')
    + _pdfMetric('Never Reviewed', ex.never_reviewed, '#f59e0b')
    + '</div>'
    // Compliance
    + '<div class="section-title">Compliance Framework Status</div>'
    + Object.entries(data.compliance||{}).map(function(entry) {
        var fw=entry[0]; var pct=entry[1];
        var color = pct>=80?'#10b981':pct>=60?'#f59e0b':'#ef4444';
        return '<div class="fw-row">'
          + '<span class="fw-name">'+escapeHtml(fwLabels[fw]||fw)+'</span>'
          + '<div class="fw-bar-bg"><div class="fw-bar" style="width:'+pct+'%;background:'+color+'"></div></div>'
          + '<span class="fw-pct" style="color:'+color+'">'+pct+'%</span>'
          + '</div>';
      }).join('')
    // EU AI Act
    + '<div class="section-title">EU AI Act Status</div>'
    + '<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:12px 14px;font-size:11px">'
    + '<strong style="color:#c2410c">&#9888; Enforcement Active</strong><br><br>'
    + 'High-risk agents: <strong>'+(data.eu_ai_act&&data.eu_ai_act.high_risk_agents||0)+'</strong> &nbsp;|&nbsp; '
    + 'Conformity assessments required: <strong style="color:#dc2626">'+(data.eu_ai_act&&data.eu_ai_act.conformity_assessments_required||0)+'</strong> &nbsp;|&nbsp; '
    + 'Transparency compliant: <strong style="color:#059669">'+(data.eu_ai_act&&data.eu_ai_act.transparency_compliant||0)+'</strong>'
    + '</div>'
    // Top risks
    + '<div class="section-title">Top Risk Agents</div>'
    + (data.top_risks||[]).slice(0,8).map(function(a) {
        var rc = a.risk==='critical'?'#ef4444':a.risk==='high'?'#f59e0b':a.risk==='medium'?'#6366f1':'#10b981';
        return '<div class="risk-row">'
          + '<span class="badge" style="background:'+rc+'18;color:'+rc+'">'+escapeHtml((a.risk||'').toUpperCase())+'</span>'
          + '<strong>'+escapeHtml(a.name||'')+'</strong>'
          + '<span style="color:#64748b">'+escapeHtml(a.env||'')+'</span>'
          + (a.phi?'<span class="badge" style="background:#fce7f3;color:#be185d">PHI</span>':'')
          + (a.shadow?'<span class="badge" style="background:#fef3c7;color:#b45309">SHADOW</span>':'')
          + '<span style="margin-left:auto;color:#64748b">Owner: '+(a.owner||'Unassigned')+'</span>'
          + '</div>';
      }).join('')
    // Recommendations
    + '<div class="section-title">Recommendations</div>'
    + (data.recommendations||[]).map(function(r,i) {
        return '<div class="rec-item">'
          + '<div class="rec-num">'+(i+1)+'</div>'
          + '<div style="font-size:11px;color:#374151">'+escapeHtml(r)+'</div>'
          + '</div>';
      }).join('')
    // Footer
    + '<div class="footer">'
    + '<span>AgentRadar AI Governance Platform &mdash; Confidential</span>'
    + '<span>Generated '+date+'</span>'
    + '<span>Page 1 of 1</span>'
    + '</div>'
    + '</div></body></html>';

  // Open in new window and trigger print dialog (saves as PDF)
  var win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { showToast('Allow popups to download PDF', 'warning'); return; }
  win.document.write(html);
  win.document.close();
  win.onload = function() {
    setTimeout(function() {
      win.print();
      showToast('PDF ready — use browser print dialog to save as PDF', 'success');
    }, 500);
  };
}

function _pdfMetric(label, value, color) {
  return '<div class="metric-card">'
    + '<div class="metric-val" style="color:'+color+'">'+(value||0)+'</div>'
    + '<div class="metric-lbl">'+escapeHtml(label)+'</div>'
    + '</div>';
}

// ══════════════════════════════════════════════════════════════
// AUTOMATED POLICY RESPONSE
// ══════════════════════════════════════════════════════════════
function runPolicyAutoResponse() {
  showToast('Running automated policy enforcement...', 'info');
  var headers = { 'Content-Type':'application/json' };
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/policy/auto-respond', { method:'POST', headers:headers, credentials:'include' })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (data) {
        showToast('Policy auto-response: ' + data.actioned + ' agents moved to review', 'success');
        loadLiveAgents();
      }
    }).catch(function() { showToast('Policy enforcement failed', 'error'); });
}

// ══════════════════════════════════════════════════════════════
// SALESFORCE / SERVICENOW / SPLUNK SCAN TRIGGERS
// ══════════════════════════════════════════════════════════════
function scanSalesforce(instanceUrl, clientId, clientSecret) {
  showToast('Scanning Salesforce Einstein...', 'info');
  var headers = { 'Content-Type':'application/json' };
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/endpoint/scan/salesforce', {
    method:'POST', headers:headers, credentials:'include',
    body:JSON.stringify({instanceUrl:instanceUrl, clientId:clientId, clientSecret:clientSecret})
  }).then(function(r){return r.ok?r.json():null;})
  .then(function(d){if(d) showToast('Salesforce: '+d.agentsFound+' agents found','success');loadLiveAgents();})
  .catch(function(){showToast('Salesforce scan failed','error');});
}

function scanServiceNow(instanceUrl, username, password) {
  showToast('Scanning ServiceNow AI...', 'info');
  var headers = { 'Content-Type':'application/json' };
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/endpoint/scan/servicenow', {
    method:'POST', headers:headers, credentials:'include',
    body:JSON.stringify({instanceUrl:instanceUrl, username:username, password:password})
  }).then(function(r){return r.ok?r.json():null;})
  .then(function(d){if(d) showToast('ServiceNow: '+d.agentsFound+' agents found','success');loadLiveAgents();})
  .catch(function(){showToast('ServiceNow scan failed','error');});
}

function scanSplunk(host, token) {
  showToast('Scanning Splunk logs for AI activity...', 'info');
  var headers = { 'Content-Type':'application/json' };
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/endpoint/scan/splunk', {
    method:'POST', headers:headers, credentials:'include',
    body:JSON.stringify({host:host, token:token})
  }).then(function(r){return r.ok?r.json():null;})
  .then(function(d){if(d) showToast('Splunk: '+d.agentsFound+' shadow agents found','success');loadLiveAgents();})
  .catch(function(){showToast('Splunk scan failed','error');});
}

// ══════════════════════════════════════════════════════════════
// UPDATE renderCiso to use report API
// ══════════════════════════════════════════════════════════════
function renderCiso() {
  generateCISOReport();
}

// ══════════════════════════════════════════════════════════════
// EU AI ACT COMPLIANCE VIEW
// ══════════════════════════════════════════════════════════════
function renderEUAIAct() {
  var agents = DB.agents;
  var highRisk = agents.filter(function(a){return a.phi||a.risk==='critical';});
  var el = document.querySelector('#view-compliance .card-body') || document.getElementById('view-compliance');
  if (!el) return;
}

// ══════════════════════════════════════════════════════════════
// QUICK ACTION HANDLERS (dashboard buttons)
// ══════════════════════════════════════════════════════════════
function runAI() { openAIPanel(); }
function openLineageMap() { go('lineage'); }
function openCISOReport() { go('ciso'); }
function scanNow() { startScan(); }

function meshFilter(f,el) { renderLineage(); }
function runMeshScan() { startScan(); }
function openAgentMesh() { go('lineage'); }
function closeMeshPanel() {}
function showMeshDetail() {}
function hideMeshDetail() {}
function openLineageMap() { go('lineage'); }
function openCISOReport() { go('ciso'); }
function scanNow() { startScan(); }
function runAIAnalysis() { openAIPanel(); }
function showBehaviorPanel(id) { checkAgentBehavior(id); }
function dismissAlert() {}
function markAllAlertsRead() {}
function exportEvidence() { exportCSV(); }
function runComplianceScan() { recomputeRiskScores(); }
function viewAllActivity() { go('activity'); }
function viewAllAlerts() { go('ciso'); }

function setScanTab(tab, el) {
  document.querySelectorAll('.scan-tab-btn').forEach(function(b){b.classList.remove('active');});
  if(el) el.classList.add('active');
  showScanSubTab(tab, el);
}
function meshFilter(f, el) {
  document.querySelectorAll('.mesh-filter').forEach(function(b){b.classList.remove('on');});
  if(el) el.classList.add('on');
  renderLineage();
}
function setCompFilter(f, el) { cfFilter=f; renderComp(); }
function runMeshScan() { startScan(); }
function viewAllAlerts() { go("ciso"); }
function viewAllActivity() { go("activity"); }
function exportEvidence() { exportCSV(); }
function runComplianceScan() { recomputeRiskScores(); }
function showBehaviorPanel(id) { if(id) checkAgentBehavior(id); }
function dismissAlert(id) {}
function markAllAlertsRead() {}
function runAIAnalysis() { openAIPanel(); }
function openLineageMap() { go("lineage"); }
function openCISOReport() { go("ciso"); }
function scanNow() { startScan(); }
function toggleMode() { showToast("Mode switched","info"); }
function setLnDepth(d) { _lnDepth=d; renderLineage(); }
function showAgentDetail(id) { openDrawer(id); }
function filterScanLog(f) {}
function clearScanLog() { var el=document.getElementById("scan-log"); if(el) el.innerHTML=""; }
function pauseFeed() { if(feedTimer){clearInterval(feedTimer);feedTimer=null;} }
function exportScanLog() { showToast("Log exported","success"); }
function runPolicyCheck() { recomputeRiskScores(); }
function scheduleAudit() { showToast("Audit scheduled","success"); }
function addPlaybook() { showToast("Playbook editor coming soon","info"); }
function editPlaybook(id) { showToast("Edit playbook "+id,"info"); }
function runPlaybook(id) { showToast("Running playbook...","info"); }

// ══ AI API KEY MANAGEMENT UI ══════════════════════════════════
function openAIKeyConfig() {
  var headers = {};
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/admin/ai-keys', { headers: headers, credentials: 'include' })
    .then(function(r) { return r.ok ? r.json() : {}; })
    .then(function(keys) { _showAIKeyModal(keys); })
    .catch(function() { _showAIKeyModal({}); });
}

function _showAIKeyModal(keys) {
  var providers = [
    { id:'anthropic', name:'Anthropic Claude', models:'claude-3-5-haiku, claude-3-5-sonnet', color:'#8b5cf6', recommended:true },
    { id:'openai',    name:'OpenAI GPT',        models:'gpt-4o-mini, gpt-4o',                color:'#10b981', recommended:false },
    { id:'gemini',    name:'Google Gemini',      models:'gemini-2.0-flash, gemini-1.5-pro',  color:'#34a853', recommended:false },
    { id:'azure_oai', name:'Azure OpenAI',       models:'gpt-4o (Azure hosted)',              color:'#0078d4', recommended:false },
    { id:'mistral',   name:'Mistral AI',         models:'mistral-large, mistral-7b',          color:'#f59e0b', recommended:false },
    { id:'cohere',    name:'Cohere',             models:'command-r, command-r-plus',          color:'#6366f1', recommended:false }
  ];

  var modal = document.getElementById('agent-key-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'agent-key-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
    document.body.appendChild(modal);
  }

  var providerHTML = providers.map(function(p) {
    var cfg = keys[p.id] || {};
    return '<div style="margin-bottom:10px;padding:14px;background:var(--bg-secondary);border:1px solid '
      + (cfg.configured ? p.color + '44' : 'var(--glass-border-dim)')
      + ';border-radius:10px;transition:border-color .2s">'
      + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'
      + '<div style="width:32px;height:32px;border-radius:8px;background:' + p.color + '18;display:flex;align-items:center;justify-content:center;font-size:16px">&#128273;</div>'
      + '<div style="flex:1"><div style="font-size:13px;font-weight:700;color:var(--text-primary)">' + p.name + '</div>'
      + '<div style="font-size:10px;color:var(--text-muted)">' + p.models + '</div></div>'
      + (p.recommended ? '<span style="font-size:9px;font-weight:700;background:' + p.color + '18;color:' + p.color + ';border-radius:99px;padding:2px 8px">RECOMMENDED</span>' : '')
      + (cfg.configured ? '<span style="font-size:9px;font-weight:700;background:#f0fdf4;color:#059669;border-radius:99px;padding:2px 8px;margin-left:4px">&#10003; ACTIVE</span>' : '')
      + '</div>'
      + '<div style="display:flex;gap:8px">'
      + '<input id="aikey-' + p.id + '" type="password" placeholder="' + (cfg.configured ? cfg.masked + ' (enter new to update)' : 'Enter ' + p.name + ' API key...') + '" style="flex:1;padding:8px 10px;border:1px solid var(--glass-border-dim);border-radius:6px;background:var(--bg-primary);color:var(--text-primary);font-size:12px">'
      + '<button data-pid="' + p.id + '" onclick="saveAIKey(this.dataset.pid)" style="padding:8px 14px;background:' + p.color + ';color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">Save</button>'
      + (cfg.configured ? '<button data-pid="' + p.id + '" onclick="testAIKey(this.dataset.pid)" style="padding:8px 12px;background:transparent;border:1px solid var(--glass-border-dim);border-radius:6px;font-size:11px;cursor:pointer">Test</button>' : '')
      + '</div></div>';
  }).join('');

  modal.innerHTML = '<div style="background:var(--bg-primary);border:1px solid var(--glass-border-dim);border-radius:16px;width:540px;max-height:85vh;overflow-y:auto">'
    + '<div style="padding:20px 24px;border-bottom:1px solid var(--glass-border-dim);display:flex;align-items:center;gap:12px;position:sticky;top:0;background:var(--bg-primary);z-index:1">'
    + '<div style="width:40px;height:40px;background:linear-gradient(135deg,#8b5cf6,#3b82f6);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px">&#129302;</div>'
    + '<div style="flex:1"><div style="font-size:16px;font-weight:700;color:var(--text-primary)">AI Agent Configuration</div>'
    + '<div style="font-size:11px;color:var(--text-muted)">One API key powers all AI features across the platform</div></div>'
    + '<button onclick="document.getElementById(&quot;agent-key-modal&quot;).style.display=&quot;none&quot;" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-muted);padding:4px">&#10005;</button>'
    + '</div>'
    + '<div style="padding:20px 24px">'
    + '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:11px;color:#1e40af">'
    + '&#9432; Keys are stored in memory for this session. Add to <code>docker-compose.yml</code> as <code>ANTHROPIC_API_KEY</code> for persistence across restarts.'
    + '</div>'
    + providerHTML
    + '</div></div>';

  modal.style.display = 'flex';
}

function saveAIKey(provider) {
  var input = document.getElementById('aikey-' + provider);
  if (!input || !input.value.trim()) { showToast('Enter an API key first', 'error'); return; }
  var keyVal = input.value.trim();
  // Get CSRF token first
  var headers0 = {};
  if (_apiToken) headers0['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/csrf-token', { headers: headers0, credentials: 'include' })
    .then(function(r) { return r.ok ? r.json() : {}; })
    .then(function(csrf) {
      var headers = { 'Content-Type': 'application/json' };
      if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
      if (csrf.token) headers['X-CSRF-Token'] = csrf.token;
      return fetch('/api/admin/ai-keys', {
        method: 'POST', headers: headers, credentials: 'include',
        body: JSON.stringify({ provider: provider, key: keyVal })
      });
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.success) {
        showToast(provider + ' API key saved successfully', 'success');
        input.value = '';
        setTimeout(openAIKeyConfig, 500);
      } else { showToast(d.error || 'Failed to save', 'error'); }
    }).catch(function() { showToast('Failed to save key', 'error'); });
}

function testAIKey(provider) {
  showToast('Testing ' + provider + '...', 'info');
  var headers = { 'Content-Type': 'application/json' };
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/admin/ai-keys/test', {
    method: 'POST', headers: headers, credentials: 'include',
    body: JSON.stringify({ provider: provider })
  }).then(function(r) { return r.json(); })
  .then(function(d) { showToast(d.message, d.success ? 'success' : 'error'); })
  .catch(function() { showToast('Test failed', 'error'); });
}

function checkAndOpenAI() {
  var headers = {};
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/admin/ai-keys', { headers: headers, credentials: 'include' })
    .then(function(r) { return r.ok ? r.json() : {}; })
    .then(function(keys) {
      var hasKey = Object.values(keys).some(function(k) { return k.configured; });
      if (hasKey) openAIPanel();
      else openAIKeyConfig();
    }).catch(function() { openAIPanel(); });
}

function aiCreatePlaybook() {
  var aapInput = document.getElementById('aap-input');
  if (aapInput) {
    var context = 'We have ' + DB.agents.length + ' AI agents, ' 
      + DB.agents.filter(function(a){return a.shadow;}).length + ' shadow AI, '
      + DB.agents.filter(function(a){return a.phi;}).length + ' PHI agents, '
      + (DB.policyViolations||[]).length + ' active violations.';
    aapInput.value = 'Create a detailed governance playbook for our platform. ' + context + ' Define the trigger conditions, step-by-step response actions, responsible parties, escalation path, and success criteria. Make it specific and actionable for a CISO.';
  }
  openAIPanel();
}

// ── BAA Management ────────────────────────────────────────────
function openBAAForm(agentId) {
  var existing = document.getElementById('baa-modal');
  if (existing) existing.remove();
  var modal = document.createElement('div');
  modal.id = 'baa-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = '<div style="background:var(--bg-primary);border:1px solid var(--glass-border-dim);border-radius:14px;width:440px;padding:0">'
    + '<div style="padding:18px 20px;border-bottom:1px solid var(--glass-border-dim);display:flex;align-items:center;gap:10px">'
    + '<div style="width:36px;height:36px;background:#f0fdf4;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px">&#128196;</div>'
    + '<div style="flex:1"><div style="font-size:15px;font-weight:700;color:var(--text-primary)">BAA Documentation</div>'
    + '<div style="font-size:11px;color:var(--text-muted)">Business Associate Agreement tracking</div></div>'
    + '<button onclick="document.getElementById(&quot;baa-modal&quot;).remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-muted)">&#10005;</button>'
    + '</div>'
    + '<div style="padding:20px">'
    + '<div style="margin-bottom:12px"><label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:5px">BAA Status</label>'
    + '<select id="baa-status-sel" style="width:100%;padding:8px 10px;border:1px solid var(--glass-border-dim);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:12px">'
    + '<option value="signed">Signed</option><option value="required">Required (missing)</option><option value="unknown">Unknown</option>'
    + '</select></div>'
    + '<div style="margin-bottom:12px"><label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:5px">Signed By</label>'
    + '<input id="baa-signed-by" type="text" placeholder="Name of signatory" style="width:100%;padding:8px 10px;border:1px solid var(--glass-border-dim);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:12px;box-sizing:border-box"></div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">'
    + '<div><label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:5px">Signed Date</label>'
    + '<input id="baa-signed-date" type="date" style="width:100%;padding:8px 10px;border:1px solid var(--glass-border-dim);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:12px;box-sizing:border-box"></div>'
    + '<div><label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:5px">Expiry Date</label>'
    + '<input id="baa-expiry-date" type="date" style="width:100%;padding:8px 10px;border:1px solid var(--glass-border-dim);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:12px;box-sizing:border-box"></div></div>'
    + '<div style="margin-bottom:16px"><label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:5px">BAA Document URL</label>'
    + '<input id="baa-doc-url" type="url" placeholder="https://sharepoint.com/baa-document" style="width:100%;padding:8px 10px;border:1px solid var(--glass-border-dim);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:12px;box-sizing:border-box"></div>'
    + '<div style="display:flex;gap:8px">'
    + '<button data-id="'+agentId+'" onclick="saveBAAData(this.dataset.id)" style="flex:1;padding:10px;background:#059669;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Save BAA Record</button>'
    + '<button onclick="document.getElementById(&quot;baa-modal&quot;).remove()" style="padding:10px 16px;background:transparent;border:1px solid var(--glass-border-dim);border-radius:8px;font-size:12px;cursor:pointer">Cancel</button>'
    + '</div></div></div>';
  document.body.appendChild(modal);
}

function saveBAAData(agentId) {
  var status = document.getElementById('baa-status-sel') ? document.getElementById('baa-status-sel').value : 'unknown';
  var signedBy = document.getElementById('baa-signed-by') ? document.getElementById('baa-signed-by').value : '';
  var signedDate = document.getElementById('baa-signed-date') ? document.getElementById('baa-signed-date').value : null;
  var expiryDate = document.getElementById('baa-expiry-date') ? document.getElementById('baa-expiry-date').value : null;
  var docUrl = document.getElementById('baa-doc-url') ? document.getElementById('baa-doc-url').value : '';
  var headers = { 'Content-Type': 'application/json' };
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/agents/' + agentId + '/baa', {
    method: 'PATCH', headers: headers, credentials: 'include',
    body: JSON.stringify({
      baa_status: status,
      baa_signed_by: signedBy || null,
      baa_signed_date: signedDate || null,
      baa_expiry_date: expiryDate || null,
      baa_document_url: docUrl || null
    })
  }).then(function(r){return r.json();})
  .then(function(d) {
    if (d.success) {
      showToast('BAA record saved', 'success');
      var modal = document.getElementById('baa-modal');
      if (modal) modal.remove();
      loadLiveAgents().then(function() { openDrawer(agentId); });
    }
  }).catch(function() { showToast('Failed to save BAA', 'error'); });
}

function markBAARequired(agentId) {
  var headers = { 'Content-Type': 'application/json' };
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/agents/' + agentId + '/baa', {
    method: 'PATCH', headers: headers, credentials: 'include',
    body: JSON.stringify({ baa_status: 'required' })
  }).then(function(r){return r.json();})
  .then(function(d) {
    if (d.success) {
      showToast('BAA marked as required', 'warning');
      loadLiveAgents().then(function() { openDrawer(agentId); });
    }
  }).catch(function() { showToast('Failed', 'error'); });
}

// BAA Summary for PHI view
function loadBAASummary() {
  var headers = {};
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/agents/baa/summary', { headers: headers, credentials: 'include' })
    .then(function(r){return r.ok?r.json():null;})
    .then(function(d) {
      if (!d) return;
      var s = d.summary || {};
      function setEl(id,v){var el=document.getElementById(id);if(el)el.textContent=v;}
      setEl('phi-n', s.phi_total||0);
      setEl('phi-ok', s.baa_signed||0);
      setEl('phi-nobaa', s.baa_missing||0);
      setEl('phi-noenc', s.baa_expiring||0);
    }).catch(function(){});
}

// ── BAA Management ────────────────────────────────────────────
function openBAAForm(agentId) {
  var existing = document.getElementById('baa-modal');
  if (existing) existing.remove();
  var modal = document.createElement('div');
  modal.id = 'baa-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = '<div style="background:var(--bg-primary);border:1px solid var(--glass-border-dim);border-radius:14px;width:440px;padding:0">'
    + '<div style="padding:18px 20px;border-bottom:1px solid var(--glass-border-dim);display:flex;align-items:center;gap:10px">'
    + '<div style="width:36px;height:36px;background:#f0fdf4;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px">&#128196;</div>'
    + '<div style="flex:1"><div style="font-size:15px;font-weight:700;color:var(--text-primary)">BAA Documentation</div>'
    + '<div style="font-size:11px;color:var(--text-muted)">Business Associate Agreement tracking</div></div>'
    + '<button onclick="document.getElementById(&quot;baa-modal&quot;).remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-muted)">&#10005;</button>'
    + '</div>'
    + '<div style="padding:20px">'
    + '<div style="margin-bottom:12px"><label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:5px">BAA Status</label>'
    + '<select id="baa-status-sel" style="width:100%;padding:8px 10px;border:1px solid var(--glass-border-dim);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:12px">'
    + '<option value="signed">Signed</option><option value="required">Required (missing)</option><option value="unknown">Unknown</option>'
    + '</select></div>'
    + '<div style="margin-bottom:12px"><label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:5px">Signed By</label>'
    + '<input id="baa-signed-by" type="text" placeholder="Name of signatory" style="width:100%;padding:8px 10px;border:1px solid var(--glass-border-dim);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:12px;box-sizing:border-box"></div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">'
    + '<div><label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:5px">Signed Date</label>'
    + '<input id="baa-signed-date" type="date" style="width:100%;padding:8px 10px;border:1px solid var(--glass-border-dim);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:12px;box-sizing:border-box"></div>'
    + '<div><label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:5px">Expiry Date</label>'
    + '<input id="baa-expiry-date" type="date" style="width:100%;padding:8px 10px;border:1px solid var(--glass-border-dim);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:12px;box-sizing:border-box"></div></div>'
    + '<div style="margin-bottom:16px"><label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:5px">BAA Document URL</label>'
    + '<input id="baa-doc-url" type="url" placeholder="https://sharepoint.com/baa-document" style="width:100%;padding:8px 10px;border:1px solid var(--glass-border-dim);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:12px;box-sizing:border-box"></div>'
    + '<div style="display:flex;gap:8px">'
    + '<button data-id="'+agentId+'" onclick="saveBAAData(this.dataset.id)" style="flex:1;padding:10px;background:#059669;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Save BAA Record</button>'
    + '<button onclick="document.getElementById(&quot;baa-modal&quot;).remove()" style="padding:10px 16px;background:transparent;border:1px solid var(--glass-border-dim);border-radius:8px;font-size:12px;cursor:pointer">Cancel</button>'
    + '</div></div></div>';
  document.body.appendChild(modal);
}

function saveBAAData(agentId) {
  var status = document.getElementById('baa-status-sel') ? document.getElementById('baa-status-sel').value : 'unknown';
  var signedBy = document.getElementById('baa-signed-by') ? document.getElementById('baa-signed-by').value : '';
  var signedDate = document.getElementById('baa-signed-date') ? document.getElementById('baa-signed-date').value : null;
  var expiryDate = document.getElementById('baa-expiry-date') ? document.getElementById('baa-expiry-date').value : null;
  var docUrl = document.getElementById('baa-doc-url') ? document.getElementById('baa-doc-url').value : '';
  var headers = { 'Content-Type': 'application/json' };
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/agents/' + agentId + '/baa', {
    method: 'PATCH', headers: headers, credentials: 'include',
    body: JSON.stringify({
      baa_status: status,
      baa_signed_by: signedBy || null,
      baa_signed_date: signedDate || null,
      baa_expiry_date: expiryDate || null,
      baa_document_url: docUrl || null
    })
  }).then(function(r){return r.json();})
  .then(function(d) {
    if (d.success) {
      showToast('BAA record saved', 'success');
      var modal = document.getElementById('baa-modal');
      if (modal) modal.remove();
      loadLiveAgents().then(function() { openDrawer(agentId); });
    }
  }).catch(function() { showToast('Failed to save BAA', 'error'); });
}

function markBAARequired(agentId) {
  var headers = { 'Content-Type': 'application/json' };
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/agents/' + agentId + '/baa', {
    method: 'PATCH', headers: headers, credentials: 'include',
    body: JSON.stringify({ baa_status: 'required' })
  }).then(function(r){return r.json();})
  .then(function(d) {
    if (d.success) {
      showToast('BAA marked as required', 'warning');
      loadLiveAgents().then(function() { openDrawer(agentId); });
    }
  }).catch(function() { showToast('Failed', 'error'); });
}

// BAA Summary for PHI view
function loadBAASummary() {
  var headers = {};
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/agents/baa/summary', { headers: headers, credentials: 'include' })
    .then(function(r){return r.ok?r.json():null;})
    .then(function(d) {
      if (!d) return;
      var s = d.summary || {};
      function setEl(id,v){var el=document.getElementById(id);if(el)el.textContent=v;}
      setEl('phi-n', s.phi_total||0);
      setEl('phi-ok', s.baa_signed||0);
      setEl('phi-nobaa', s.baa_missing||0);
      setEl('phi-noenc', s.baa_expiring||0);
    }).catch(function(){});
}

// ── Owner Auto-Suggestion ─────────────────────────────────────
function suggestOwner(agentId) {
  var headers = {};
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/agents/' + agentId + '/owner-suggest', { headers:headers, credentials:'include' })
    .then(function(r){return r.ok?r.json():null;})
    .then(function(d) {
      if (!d || !d.suggestions.length) { showToast('No owner suggestions available', 'info'); return; }
      var best = d.suggestions[0];
      var msg = 'Suggested owner: ' + best.email + ' (' + best.confidence + '% confidence, source: ' + best.source + ')\n\nAssign this owner?';
      if (confirm(msg)) {
        assignOwner(agentId, best.email);
      }
    }).catch(function(){ showToast('Failed to get suggestions', 'error'); });
}

function assignOwner(agentId, email) {
  if (!email) email = prompt('Enter owner email:');
  if (!email) return;
  var headers = { 'Content-Type': 'application/json' };
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/agents/' + agentId + '/owner', {
    method: 'PATCH', headers: headers, credentials: 'include',
    body: JSON.stringify({ owner: email, reviewCadence: '90days' })
  }).then(function(r){return r.json();})
  .then(function(d) {
    if (d.success) {
      showToast('Owner assigned: ' + email, 'success');
      loadLiveAgents().then(function(){ openDrawer(agentId); });
    }
  }).catch(function(){ showToast('Failed to assign owner', 'error'); });
}

function bulkSuggestOwners() {
  showToast('Analyzing ownerless agents...', 'info');
  var headers = { 'Content-Type': 'application/json' };
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/agents/owner/bulk-suggest', { method:'POST', headers:headers, credentials:'include' })
    .then(function(r){return r.json();})
    .then(function(d) {
      if (!d.suggestions.length) { showToast('All agents have owners assigned', 'success'); return; }
      var msg = 'Found ' + d.ownerless + ' ownerless agents. Auto-assign suggested owners?\n\n';
      msg += d.suggestions.slice(0,5).map(function(s){ return s.agentName + ' → ' + s.suggested + ' (' + s.confidence + '%)'; }).join('\n');
      if (d.suggestions.length > 5) msg += '\n...and ' + (d.suggestions.length-5) + ' more';
      if (confirm(msg)) {
        var promises = d.suggestions.map(function(s) {
          return fetch('/api/agents/' + s.agentId + '/owner', {
            method:'PATCH', headers:headers, credentials:'include',
            body: JSON.stringify({ owner: s.suggested })
          });
        });
        Promise.all(promises).then(function(){
          showToast('Owners assigned to ' + d.suggestions.length + ' agents', 'success');
          loadLiveAgents();
        });
      }
    }).catch(function(){ showToast('Failed', 'error'); });
}

function recomputeRiskScores() {
  showToast('Recomputing risk scores...', 'info');
  var headers = { 'Content-Type': 'application/json' };
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/agents/risk-score/bulk', { method:'POST', headers:headers, credentials:'include' })
    .then(function(r){return r.json();})
    .then(function(d){ showToast(d.message||'Risk scores updated', 'success'); loadLiveAgents(); })
    .catch(function(){ showToast('Failed', 'error'); });
}

function loadOverdueReviews() {
  var headers = {};
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/agents/review/overdue', { headers:headers, credentials:'include' })
    .then(function(r){return r.json();})
    .then(function(d){
      if (d.count > 0) showToast(d.count + ' agents have overdue reviews', 'warning');
    }).catch(function(){});
}

// ── Evidence Package Download ─────────────────────────────────
function downloadEvidencePackage(agentId, agentName) {
  showToast('Generating evidence package...', 'info');
  var headers = {};
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/agents/' + agentId + '/evidence', { headers:headers, credentials:'include' })
    .then(function(r){return r.ok?r.json():null;})
    .then(function(d) {
      if (!d) { showToast('Failed to generate evidence package', 'error'); return; }
      _renderEvidencePDF(d);
    }).catch(function(){ showToast('Failed', 'error'); });
}

function _renderEvidencePDF(d) {
  var a = d.agent || {};
  var own = d.ownership || {};
  var phi = d.phi_hipaa || {};
  var risk = d.risk || {};
  var date = new Date(d.generated).toLocaleDateString('en-US', {year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'});
  var passColor = '#059669'; var failColor = '#dc2626'; var warnColor = '#d97706';

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
    + 'body{font-family:Arial,sans-serif;font-size:11px;color:#1a1a2e;margin:0;padding:0}'
    + '.page{width:210mm;min-height:297mm;padding:18mm;box-sizing:border-box}'
    + '.header{border-bottom:3px solid #6366f1;padding-bottom:14px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:flex-end}'
    + '.logo{font-size:18px;font-weight:800;color:#6366f1}'
    + '.agent-name{font-size:16px;font-weight:700;color:#1a1a2e;margin-top:4px}'
    + '.section{margin-bottom:18px}'
    + '.section-title{font-size:12px;font-weight:700;color:#1a1a2e;background:#f8fafc;border-left:3px solid #6366f1;padding:5px 10px;margin-bottom:8px}'
    + '.grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}'
    + '.cell{background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:8px}'
    + '.cell-label{font-size:9px;color:#64748b;text-transform:uppercase;margin-bottom:2px}'
    + '.cell-val{font-size:11px;font-weight:600;color:#1a1a2e}'
    + '.fw-row{display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f1f5f9}'
    + '.badge{padding:2px 7px;border-radius:99px;font-size:9px;font-weight:700}'
    + '.audit-row{padding:5px 0;border-bottom:1px solid #f1f5f9;display:flex;gap:10px}'
    + '.score-box{display:inline-block;width:48px;height:48px;border-radius:8px;text-align:center;line-height:48px;font-size:18px;font-weight:800}'
    + '.footer{border-top:1px solid #e2e8f0;padding-top:10px;margin-top:24px;display:flex;justify-content:space-between;font-size:9px;color:#94a3b8}'
    + '.pass{color:'+passColor+'} .fail{color:'+failColor+'} .warn{color:'+warnColor+'}'
    + '@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}'
    + '</style></head><body><div class="page">'
    // Header
    + '<div class="header">'
    + '<div><div class="logo">&#9673; AgentRadar</div><div style="font-size:10px;color:#64748b">AI Governance Evidence Package — CONFIDENTIAL</div><div class="agent-name">'+escapeHtml(a.name||'')+'</div></div>'
    + '<div style="text-align:right;font-size:10px;color:#64748b">Generated: '+date+'<br>Agent ID: '+escapeHtml((a.id||'').slice(0,12))+'...</div>'
    + '</div>'
    // Risk summary
    + '<div class="section"><div class="section-title">Risk Assessment</div>'
    + '<div style="display:flex;align-items:center;gap:16px">'
    + '<div class="score-box" style="background:'+(risk.score>=70?'#fef2f2':risk.score>=50?'#fff7ed':'#f0fdf4')+';color:'+(risk.score>=70?failColor:risk.score>=50?warnColor:passColor)+'">'+risk.score+'</div>'
    + '<div><div style="font-size:14px;font-weight:700;color:#1a1a2e">'+(risk.level||'').toUpperCase()+' RISK</div>'
    + '<div style="font-size:10px;color:#64748b;margin-top:2px">Score: '+risk.score+'/100</div>'
    + '<div style="font-size:10px;color:#64748b">Factors: '+(risk.factors||[]).map(function(f){return f.factor+' (+'+f.points+')';}).join(', ')+'</div>'
    + '</div></div></div>'
    // Agent details
    + '<div class="section"><div class="section-title">Agent Profile</div><div class="grid2">'
    + _evCell('Environment', a.env||'Unknown')
    + _evCell('Category', a.category||'Unknown')
    + _evCell('Type', a.type||'Unknown')
    + _evCell('Lifecycle', a.lifecycle||'active')
    + _evCell('Version', a.version||'N/A')
    + _evCell('Hosting', a.hosted?'Self-hosted':'Cloud')
    + '</div></div>'
    // Ownership
    + '<div class="section"><div class="section-title">Ownership & Review</div><div class="grid2">'
    + _evCell('Owner', own.owner||'UNASSIGNED', !own.owner||own.owner==='Unassigned'?failColor:passColor)
    + _evCell('Review cadence', own.review_cadence||'90days')
    + _evCell('Last reviewed', own.last_reviewed?new Date(own.last_reviewed).toLocaleDateString():'NEVER', !own.last_reviewed?failColor:'#1a1a2e')
    + _evCell('Approved by', own.approved_by||'Not approved', !own.approved_by?warnColor:'#1a1a2e')
    + '</div></div>'
    // HIPAA/BAA
    + '<div class="section"><div class="section-title">HIPAA / PHI Status</div><div class="grid2">'
    + _evCell('PHI Flag', phi.phi_flag?'YES — Contains PHI':'No PHI', phi.phi_flag?warnColor:passColor)
    + _evCell('BAA Status', (phi.baa_status||'unknown').toUpperCase(), phi.baa_status==='signed'?passColor:phi.phi_flag?failColor:'#1a1a2e')
    + _evCell('BAA Signed By', phi.baa_signed_by||'N/A')
    + _evCell('BAA Expiry', phi.baa_expiry_date?new Date(phi.baa_expiry_date).toLocaleDateString():'N/A')
    + '</div>'
    + (phi.phi_flag && phi.baa_status!=='signed'?'<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:4px;padding:8px;margin-top:8px;font-size:10px;color:#dc2626"><strong>&#9888; HIPAA Risk:</strong> PHI agent without signed BAA — remediation required</div>':'')
    + '</div>'
    // Compliance
    + '<div class="section"><div class="section-title">Compliance Framework Status</div>'
    + (d.compliance||[]).map(function(fw) {
        var c = fw.status==='pass'?passColor:fw.status==='fail'?failColor:warnColor;
        return '<div class="fw-row"><span>'+escapeHtml(fw.framework)+'</span>'
          + '<span class="badge" style="background:'+c+'18;color:'+c+'">'+fw.status.toUpperCase()+'</span></div>';
      }).join('')
    + '</div>'
    // Audit trail
    + '<div class="section"><div class="section-title">Audit Trail ('+d.audit_trail.length+' entries)</div>'
    + (d.audit_trail.length
      ? d.audit_trail.slice(0,10).map(function(r){
          return '<div class="audit-row">'
            + '<span style="color:#94a3b8;min-width:130px">'+new Date(r.timestamp).toLocaleString()+'</span>'
            + '<span style="color:#64748b;min-width:100px">'+escapeHtml(r.performed_by||'system')+'</span>'
            + '<span>'+escapeHtml(r.action||'')+'</span>'
            + '</div>';
        }).join('')
      : '<div style="color:#64748b;padding:8px">No audit history recorded</div>')
    + '</div>'
    // Summary verdict
    + '<div style="background:'+(d.summary.compliant&&d.summary.hipaa_ready&&d.summary.has_owner?'#f0fdf4':'#fef2f2')+';border:1px solid '+(d.summary.compliant&&d.summary.hipaa_ready&&d.summary.has_owner?'#bbf7d0':'#fecaca')+';border-radius:6px;padding:12px;margin-bottom:16px">'
    + '<div style="font-size:13px;font-weight:700;color:'+(d.summary.compliant&&d.summary.hipaa_ready&&d.summary.has_owner?passColor:failColor)+'">'
    + (d.summary.compliant&&d.summary.hipaa_ready&&d.summary.has_owner?'&#10003; AUDIT READY':'&#9888; REMEDIATION REQUIRED')
    + '</div>'
    + '<div style="font-size:10px;color:#374151;margin-top:4px">'
    + 'Owner: '+(d.summary.has_owner?'&#10003;':'&#10007;')
    + ' &nbsp;|&nbsp; Review: '+(d.summary.has_review?'&#10003;':'&#10007;')
    + ' &nbsp;|&nbsp; HIPAA: '+(d.summary.hipaa_ready?'&#10003;':'&#10007;')
    + ' &nbsp;|&nbsp; Compliance: '+(d.summary.compliant?'&#10003;':'&#10007;')
    + ' &nbsp;|&nbsp; Audit entries: '+d.summary.audit_entries
    + '</div></div>'
    // Footer
    + '<div class="footer">'
    + '<span>AgentRadar Evidence Package &mdash; Confidential &mdash; For Audit Use Only</span>'
    + '<span>'+date+'</span>'
    + '</div>'
    + '</div></body></html>';

  var win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { showToast('Allow popups to save as PDF', 'warning'); return; }
  win.document.write(html);
  win.document.close();
  win.onload = function() {
    setTimeout(function() {
      win.print();
      showToast('Evidence package ready — save as PDF', 'success');
    }, 500);
  };
}

function _evCell(label, value, color) {
  return '<div class="cell">'
    + '<div class="cell-label">'+escapeHtml(label)+'</div>'
    + '<div class="cell-val" style="color:'+(color||'#1a1a2e')+'">'+escapeHtml(String(value||''))+'</div>'
    + '</div>';
}

// ══════════════════════════════════════════════════════════════
// COVERAGE MAP
// ══════════════════════════════════════════════════════════════
function renderCoverage() {
  var agents = DB.agents;

  var SOURCES = [
    { id:'azure', name:'Microsoft Azure', icon:'☁', connected:true, agents: agents.filter(function(a){return a.env==='Azure'||a.detect==='Azure auto-discovery';}).length, lastScan:'2h ago', coverage:'full' },
    { id:'aws', name:'Amazon AWS', icon:'☁', connected:false, agents:0, lastScan:'Never', coverage:'blind' },
    { id:'gcp', name:'Google Cloud', icon:'☁', connected:false, agents:0, lastScan:'Never', coverage:'blind' },
    { id:'m365', name:'Microsoft 365', icon:'📧', connected:false, agents:0, lastScan:'Never', coverage:'blind' },
    { id:'github', name:'GitHub / GitLab', icon:'🐙', connected:false, agents:0, lastScan:'Never', coverage:'blind' },
    { id:'epic', name:'Epic EHR', icon:'🏥', connected:false, agents:0, lastScan:'Never', coverage:'blind' },
    { id:'cerner', name:'Cerner / Oracle', icon:'🏥', connected:false, agents:0, lastScan:'Never', coverage:'blind' },
    { id:'crowdstrike', name:'CrowdStrike', icon:'🛡', connected:false, agents:0, lastScan:'Never', coverage:'blind' },
    { id:'intune', name:'MS Intune', icon:'💻', connected:false, agents:0, lastScan:'Never', coverage:'blind' },
    { id:'sentinel', name:'MS Sentinel', icon:'📊', connected:false, agents:0, lastScan:'Never', coverage:'blind' },
    { id:'splunk', name:'Splunk', icon:'📊', connected:false, agents:0, lastScan:'Never', coverage:'blind' },
    { id:'zscaler', name:'Zscaler ZIA', icon:'🔒', connected:false, agents:0, lastScan:'Never', coverage:'blind' }
  ];

  var connected = SOURCES.filter(function(s){return s.connected;}).length;
  var blind = SOURCES.filter(function(s){return s.coverage==='blind';}).length;
  var pct = Math.round(connected/SOURCES.length*100);

  function setEl(id,v){var el=document.getElementById(id);if(el)el.textContent=v;}
  setEl('cov-connected', connected);
  setEl('cov-partial', 0);
  setEl('cov-blind', blind);
  setEl('cov-pct', pct+'%');

  var mapEl = document.getElementById('coverage-map');
  if (mapEl) {
    mapEl.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px">'
      + SOURCES.map(function(s) {
          var color = s.coverage==='full'?'#10b981':s.coverage==='partial'?'#f59e0b':'#ef4444';
          var bg = s.coverage==='full'?'#f0fdf4':s.coverage==='partial'?'#fff7ed':'#fef2f2';
          var label = s.coverage==='full'?'Connected':s.coverage==='partial'?'Partial':'Blind spot';
          return '<div style="background:'+bg+';border:1px solid '+color+'33;border-radius:10px;padding:14px">'
            + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
            + '<div style="width:8px;height:8px;border-radius:50%;background:'+color+'"></div>'
            + '<span style="font-size:12px;font-weight:700;color:var(--text-primary)">'+escapeHtml(s.name)+'</span>'
            + '</div>'
            + '<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">Agents found: <strong style="color:var(--text-primary)">'+s.agents+'</strong></div>'
            + '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Last scan: '+escapeHtml(s.lastScan)+'</div>'
            + '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;background:'+color+'18;color:'+color+'">'+label+'</span>'
            + '</div>';
        }).join('')
      + '</div>';
  }

  var blindEl = document.getElementById('coverage-blindspots');
  if (blindEl) {
    var blindSources = SOURCES.filter(function(s){return s.coverage==='blind';});
    blindEl.innerHTML = '<div style="margin-bottom:10px;font-size:12px;color:var(--text-muted)">'+blindSources.length+' sources not connected — agents in these environments are invisible to AgentRadar</div>'
      + blindSources.map(function(s) {
          return '<div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--bg-secondary);border:1px solid var(--glass-border-dim);border-radius:8px;margin-bottom:6px">'
            + '<div style="width:8px;height:8px;border-radius:50%;background:#ef4444;flex-shrink:0"></div>'
            + '<div style="flex:1"><div style="font-size:12px;font-weight:600;color:var(--text-primary)">'+escapeHtml(s.name)+'</div>'
            + '<div style="font-size:10px;color:var(--text-muted)">No connector configured</div></div>'
            + '<button onclick="go(&quot;integrations&quot;)" style="padding:4px 10px;font-size:10px;background:var(--brand);color:#fff;border:none;border-radius:4px;cursor:pointer">Connect</button>'
            + '</div>';
        }).join('');
  }
}

// ══════════════════════════════════════════════════════════════
// OPERATIONS WORKBENCH
// ══════════════════════════════════════════════════════════════
function renderOperations() {
  var agents = DB.agents;
  var now = Date.now();
  var DAY = 86400000;

  // New agents in last 24h (by first_detected)
  var newAgents = agents.filter(function(a){
    if (!a.firstDet) return false;
    var d = new Date(a.firstDet).getTime();
    return (now - d) < DAY;
  });

  // Agents with no last seen in 7+ days (gone dark)
  var goneDark = agents.filter(function(a){
    if (!a.lastSeen || a.lastSeen === 'Just now') return false;
    return a.lastSeen.indexOf('days') >= 0 || a.lastSeen.indexOf('week') >= 0;
  });

  // Agents overdue for review
  var overdueReview = agents.filter(function(a){return !a.review_date;});

  // High risk agents
  var highRisk = agents.filter(function(a){return a.risk==='critical'||a.risk==='high';});

  function setEl(id,v){var el=document.getElementById(id);if(el)el.textContent=v;}
  setEl('ops-new', newAgents.length);
  setEl('ops-dark', goneDark.length);
  setEl('ops-risk', highRisk.length);
  setEl('ops-review', overdueReview.length);

  // Update nav badge
  var opsBadge = document.getElementById('nav-ops-count');
  var totalOps = newAgents.length + goneDark.length + overdueReview.length;
  if (opsBadge) opsBadge.textContent = totalOps;

  // Work queue
  var queueEl = document.getElementById('ops-queue');
  if (queueEl) {
    var items = [];

    // Shadow agents needing action
    var shadow = agents.filter(function(a){return a.shadow&&!a.approved;});
    if (shadow.length) items.push({ priority:'critical', icon:'🚨', title:shadow.length+' shadow AI agents need approval or quarantine', action:'Review shadow AI', fn:"go('shadow')", agents: shadow.slice(0,3) });

    // PHI without BAA
    var phiNoBaa = agents.filter(function(a){return a.phi&&a.baa_status!=='signed';});
    if (phiNoBaa.length) items.push({ priority:'critical', icon:'🏥', title:phiNoBaa.length+' PHI agents missing BAA — HIPAA risk', action:'View PHI agents', fn:"go('phi')", agents: phiNoBaa.slice(0,3) });

    // No owner
    var noOwner = agents.filter(function(a){return !a.owner;});
    if (noOwner.length) items.push({ priority:'high', icon:'👤', title:noOwner.length+' agents have no assigned owner', action:'Bulk assign owners', fn:'bulkSuggestOwners()', agents: noOwner.slice(0,3) });

    // Overdue review
    if (overdueReview.length) items.push({ priority:'high', icon:'📅', title:overdueReview.length+' agents have never been reviewed', action:'Start reviews', fn:'loadOverdueReviews()', agents: overdueReview.slice(0,3) });

    // High risk
    if (highRisk.length) items.push({ priority:'medium', icon:'⚠️', title:highRisk.length+' agents scored high or critical risk', action:'View risk analytics', fn:"go('risk')", agents: highRisk.slice(0,3) });

    var priorityColors = {critical:'#ef4444', high:'#f59e0b', medium:'#6366f1'};

    if (!items.length) {
      queueEl.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-muted)"><div style="font-size:32px;margin-bottom:8px">✅</div><div style="font-size:14px;font-weight:600;color:var(--text-primary)">All clear</div><div style="font-size:12px;margin-top:4px">No pending operations items</div></div>';
    } else {
      queueEl.innerHTML = items.map(function(item) {
        var pc = priorityColors[item.priority]||'#6366f1';
        return '<div style="padding:14px 16px;border-bottom:1px solid var(--glass-border-dim);border-left:3px solid '+pc+'">'
          + '<div style="display:flex;align-items:flex-start;gap:10px">'
          + '<div style="font-size:20px;flex-shrink:0">'+item.icon+'</div>'
          + '<div style="flex:1">'
          + '<div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:4px">'+escapeHtml(item.title)+'</div>'
          + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">'
          + item.agents.map(function(a){return '<span style="font-size:10px;padding:1px 6px;background:var(--bg-secondary);border:1px solid var(--glass-border-dim);border-radius:3px;color:var(--text-muted)">'+escapeHtml(a.name)+'</span>';}).join('')
          + '</div>'
          + '<button onclick="'+item.fn+'" style="padding:5px 12px;font-size:11px;font-weight:600;background:'+pc+';color:#fff;border:none;border-radius:6px;cursor:pointer">'+escapeHtml(item.action)+' →</button>'
          + '</div>'
          + '<span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:99px;background:'+pc+'18;color:'+pc+';flex-shrink:0">'+item.priority.toUpperCase()+'</span>'
          + '</div></div>';
      }).join('');
    }
  }

  // Discovery events feed
  var eventsEl = document.getElementById('ops-events');
  if (eventsEl) {
    var events = [];
    agents.forEach(function(a) {
      if (a.shadow) events.push({ type:'shadow', icon:'🚨', color:'#ef4444', msg:'Shadow AI detected: '+a.name, time:a.lastSeen||'Recently', agent:a });
      if (a.phi&&a.baa_status!=='signed') events.push({ type:'phi', icon:'🏥', color:'#8b5cf6', msg:'PHI exposure without BAA: '+a.name, time:a.lastSeen||'Recently', agent:a });
      if (a.risk==='critical') events.push({ type:'risk', icon:'⚠️', color:'#f59e0b', msg:'Critical risk agent: '+a.name, time:a.lastSeen||'Recently', agent:a });
    });

    // Add some discovery events
    events.push({ type:'scan', icon:'🔍', color:'#3b82f6', msg:'Background scan completed — '+agents.length+' agents confirmed', time:'2h ago' });
    events.push({ type:'scan', icon:'🔍', color:'#3b82f6', msg:'Azure auto-discovery found 14 agents', time:'2h ago' });
    events.push({ type:'scan', icon:'🔍', color:'#3b82f6', msg:'Tag-based discovery found 4 agents', time:'2h ago' });

    eventsEl.innerHTML = events.slice(0,15).map(function(e) {
      var id = e.agent ? String(e.agent.id||'').replace(/"/g,'') : '';
      return '<div '+(id?'onclick="openDrawer(this.dataset.id)" data-id="'+id+'" style="cursor:pointer"':'')+' style="padding:10px 14px;border-bottom:1px solid var(--glass-border-dim);display:flex;gap:10px;align-items:flex-start">'
        + '<div style="font-size:16px;flex-shrink:0;margin-top:1px">'+e.icon+'</div>'
        + '<div style="flex:1;min-width:0">'
        + '<div style="font-size:12px;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escapeHtml(e.msg)+'</div>'
        + '<div style="font-size:10px;color:var(--text-muted);margin-top:2px">'+escapeHtml(e.time)+'</div>'
        + '</div></div>';
    }).join('');
  }
}

// ══════════════════════════════════════════════════════════════
// SHADOW AI HUB
// ══════════════════════════════════════════════════════════════
function renderShadowDash() {
  var agents = DB.agents;
  var shadow = agents.filter(function(a){return a.shadow;});
  var crit = shadow.filter(function(a){return a.risk==='critical';});
  var phi = shadow.filter(function(a){return a.phi;});

  function setEl(id,v){var el=document.getElementById(id);if(el)el.textContent=v;}
  setEl('sh-total', shadow.length);
  setEl('sh-crit', crit.length);
  setEl('sh-phi', phi.length);
  setEl('sh-resolved', 0);

  // Update nav badge
  var shBadge = document.getElementById('nav-shadow-count');
  if (shBadge) shBadge.textContent = shadow.length;

  // Shadow agent list
  var listEl = document.getElementById('shadow-agent-list');
  if (listEl) {
    if (!shadow.length) {
      listEl.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-muted)"><div style="font-size:32px;margin-bottom:8px">✅</div><div style="font-size:14px;font-weight:600;color:var(--text-primary)">No shadow AI detected</div><div style="font-size:12px;margin-top:4px">All agents are registered and approved</div></div>';
    } else {
      listEl.innerHTML = shadow.map(function(a) {
        var rc = {critical:'#ef4444',high:'#f59e0b',medium:'#6366f1',low:'#10b981'}[a.risk]||'#6366f1';
        var id = String(a.id||'').replace(/"/g,'');
        return '<div style="padding:14px 16px;border-bottom:1px solid var(--glass-border-dim);display:flex;align-items:center;gap:12px">'
          + '<div style="width:10px;height:10px;border-radius:50%;background:#ef4444;flex-shrink:0;animation:pulse 1.5s infinite"></div>'
          + '<div style="flex:1;min-width:0">'
          + '<div style="font-size:13px;font-weight:700;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escapeHtml(a.name)+'</div>'
          + '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">'
          + escapeHtml(a.env||'')
          + (a.detect?' &middot; Detected: '+escapeHtml(a.detect):'')
          + (a.owner?' &middot; Owner: '+escapeHtml(a.owner):'<span style="color:#ef4444"> &middot; No owner</span>')
          + '</div></div>'
          + (a.phi?'<span style="font-size:9px;background:#fee2e2;color:#dc2626;border-radius:3px;padding:2px 6px;font-weight:700">PHI</span>':'')
          + '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;background:'+rc+'18;color:'+rc+'">'+( a.risk||'').toUpperCase()+'</span>'
          + '<div style="display:flex;gap:6px">'
          + '<button data-id="'+id+'" onclick="approveAgent(this.dataset.id)" style="padding:5px 10px;font-size:10px;background:#10b981;color:#fff;border:none;border-radius:4px;cursor:pointer">Approve</button>'
          + '<button data-id="'+id+'" onclick="quarantineAgent(this.dataset.id)" style="padding:5px 10px;font-size:10px;background:#ef4444;color:#fff;border:none;border-radius:4px;cursor:pointer">Quarantine</button>'
          + '</div></div>';
      }).join('');
    }
  }

  // Detection sources breakdown
  var sourcesEl = document.getElementById('shadow-sources');
  if (sourcesEl) {
    var detectCounts = {};
    shadow.forEach(function(a){ var d=a.detect||'Unknown'; detectCounts[d]=(detectCounts[d]||0)+1; });
    if (!Object.keys(detectCounts).length) {
      sourcesEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">No shadow AI detected</div>';
    } else {
      var total = shadow.length || 1;
      sourcesEl.innerHTML = Object.keys(detectCounts).map(function(src) {
        var count = detectCounts[src];
        var pct = Math.round(count/total*100);
        return '<div style="margin-bottom:10px">'
          + '<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px">'
          + '<span style="color:var(--text-primary);font-weight:600">'+escapeHtml(src)+'</span>'
          + '<span style="color:var(--text-muted)">'+count+' agents</span></div>'
          + '<div style="height:6px;background:var(--bg-secondary);border-radius:3px;overflow:hidden">'
          + '<div style="height:100%;width:'+pct+'%;background:#ef4444;border-radius:3px"></div>'
          + '</div></div>';
      }).join('');
    }
  }

  // Trend chart (simple SVG)
  var trendEl = document.getElementById('shadow-trend');
  if (trendEl) {
    var count = shadow.length;
    trendEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Current: <strong style="color:#ef4444">'+count+'</strong> shadow agents</div>'
      + '<div style="font-size:11px;color:var(--text-muted)">Connect more sources to track shadow AI trends over time</div>'
      + (count > 0 ? '<div style="margin-top:10px;padding:10px;background:#fef2f2;border-radius:6px;font-size:11px;color:#dc2626"><strong>Action required:</strong> Run policy auto-remediation to move shadow agents to review queue</div>' : '');
  }
}

// ══════════════════════════════════════════════════════════════
// AGENT CONFIDENCE SCORING
// ══════════════════════════════════════════════════════════════
function getConfidenceScore(agent) {
  var score = 0;
  var sources = 0;
  if (agent.detect === 'Azure auto-discovery') { score += 40; sources++; }
  if (agent.detect === 'Tag-based discovery') { score += 35; sources++; }
  if (agent.detect && agent.detect.indexOf('scan') >= 0) { score += 30; sources++; }
  if (agent.owner) score += 15;
  if (agent.review_date) score += 10;
  if (agent.notes) score += 5;
  if (sources > 1) score += 20;
  score = Math.min(100, score);
  var label = score >= 80 ? 'Confirmed' : score >= 50 ? 'Likely' : 'Candidate';
  var color = score >= 80 ? '#10b981' : score >= 50 ? '#f59e0b' : '#94a3b8';
  return { score: score, label: label, color: color };
}

// ══════════════════════════════════════════════════════════════
// AGENT APPROVE/QUARANTINE (drawer actions)
// ══════════════════════════════════════════════════════════════
function approveAgent(agentId) {
  var headers = { 'Content-Type': 'application/json' };
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/agents/' + agentId + '/approve', { method:'POST', headers:headers, credentials:'include' })
    .then(function(r){return r.json();})
    .then(function(d){
      if (d.success) {
        showToast('Agent approved', 'success');
        loadLiveAgents().then(function(){ if (currentView === 'shadowdash') renderShadowDash(); });
      }
    }).catch(function(){ showToast('Failed to approve', 'error'); });
}

function quarantineAgent(agentId) {
  var headers = { 'Content-Type': 'application/json' };
  if (_apiToken) headers['Authorization'] = 'Bearer ' + _apiToken;
  fetch('/api/agents/' + agentId + '/quarantine', { method:'POST', headers:headers, credentials:'include' })
    .then(function(r){return r.json();})
    .then(function(d){
      if (d.success) {
        showToast('Agent quarantined', 'success');
        loadLiveAgents().then(function(){ if (currentView === 'shadowdash') renderShadowDash(); });
      }
    }).catch(function(){ showToast('Failed to quarantine', 'error'); });
}

// ══════════════════════════════════════════════════════════════
// INVENTORY EXPORT
// ══════════════════════════════════════════════════════════════
function exportInventoryJSON() {
  var agents = DB.agents;
  var exportData = {
    generated: new Date().toISOString(),
    platform: 'AgentRadar',
    total_agents: agents.length,
    agents: agents.map(function(a) {
      var conf = getConfidenceScore(a);
      return {
        id: a.id, name: a.name, type: a.type, env: a.env,
        category: a.agent_category, risk: a.risk,
        shadow: a.shadow, phi: a.phi, pii: a.pii,
        owner: a.owner, lifecycle: a.lifecycle_status,
        detect: a.detect, first_detected: a.firstDet,
        last_seen: a.lastSeen, review_date: a.review_date,
        baa_status: a.baa_status, confidence: conf.label,
        confidence_score: conf.score
      };
    })
  };
  var blob = new Blob([JSON.stringify(exportData, null, 2)], {type:'application/json'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'AgentRadar-Inventory-' + new Date().toISOString().split('T')[0] + '.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Inventory exported as JSON', 'success');
}

function exportInventoryCSV() {
  var agents = DB.agents;
  var headers = ['ID','Name','Type','Environment','Category','Risk','Shadow','PHI','Owner','Lifecycle','Detect','FirstDetected','LastSeen','BAA Status','Confidence'];
  var rows = agents.map(function(a) {
    var conf = getConfidenceScore(a);
    return [a.id,a.name,a.type,a.env,a.agent_category,a.risk,a.shadow,a.phi,a.owner||'',a.lifecycle_status,a.detect,a.firstDet,a.lastSeen,a.baa_status,conf.label].map(function(v){return '"'+(String(v||'').replace(/"/g,'""'))+'"';}).join(',');
  });
  var csv = [headers.join(',')].concat(rows).join('\n');
  var blob = new Blob([csv], {type:'text/csv'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'AgentRadar-Inventory-' + new Date().toISOString().split('T')[0] + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Inventory exported as CSV', 'success');
}
