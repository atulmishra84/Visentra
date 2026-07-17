import { safeFetch, assertAllowedUrl, ALLOW } from "../utils/http.js";
import { isAiRelevantText } from "./aiRelevance.js";
import {
  detectAssistedByFromMarkers,
  detectAssistedByFromText,
  detectAgentFrameworks,
  classifyRepoProjectKind,
  extractDependencyHints,
  buildAssistedByMetadata,
  AGENT_FILE_MARKERS
} from "./assistantPresence.js";

const GIT_MAX_REPOS = Number(process.env.GIT_DISCOVERY_MAX_REPOS || 100);

function dynamicPublicPolicy(rawUrl, basePolicy = {}) {
  const parsed = assertAllowedUrl(rawUrl, { allowPrivate: basePolicy.allowPrivate });
  return {
    allowHosts: Array.from(new Set([parsed.hostname, ...(basePolicy.allowHosts || [])])),
    allowHostSuffixes: basePolicy.allowHostSuffixes || []
  };
}

function githubBase(config = {}) {
  const base = String(config.apiBase || "https://api.github.com").replace(/\/+$/, "");
  const policy = dynamicPublicPolicy(base, ALLOW.github);
  return { base, policy };
}

function gitlabBase(config = {}) {
  const rawHost = String(config.host || "gitlab.com").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const base = `https://${rawHost}/api/v4`;
  const policy = dynamicPublicPolicy(`https://${rawHost}`, ALLOW.gitlab);
  return { base, host: rawHost, policy };
}

function requireToken(secrets = {}, provider) {
  const token = String(secrets.token || "").trim();
  if (!token) throw new Error(`${provider} token is required`);
  return token;
}

async function jsonFetch(url, init, policy, { optional = false } = {}) {
  const res = await safeFetch(url, init, policy);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (optional && (res.status === 403 || res.status === 404)) return null;
    throw new Error(json.message || json.error_description || json.error || `Git API failed (${res.status})`);
  }
  return json;
}

async function textFetch(url, init, policy, { optional = false } = {}) {
  const res = await safeFetch(url, init, policy);
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    if (optional && (res.status === 403 || res.status === 404)) return null;
    throw new Error(`Git API failed (${res.status})`);
  }
  return text;
}

async function pagedFetch(base, path, init, policy, maxPages = 3) {
  const out = [];
  for (let page = 1; page <= maxPages && out.length < GIT_MAX_REPOS; page += 1) {
    const sep = path.includes("?") ? "&" : "?";
    const json = await jsonFetch(`${base}${path}${sep}per_page=50&page=${page}`, init, policy, { optional: page > 1 });
    const rows = Array.isArray(json) ? json : Array.isArray(json?.value) ? json.value : [];
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < 50) break;
  }
  return out.slice(0, GIT_MAX_REPOS);
}

function repoObservation({
  provider,
  conn,
  id,
  name,
  fullName,
  webUrl,
  owner,
  languages,
  topics,
  workflowMatches,
  projectKind,
  extra = {}
}) {
  const providerLabel = provider === "github" ? "GitHub" : "GitLab";
  const kindLabel =
    projectKind === "agent_project"
      ? "agent project"
      : projectKind === "ai_assisted_repo"
        ? "AI-assisted repo"
        : "AI repository";
  const assistedBy = extra.assistedBy || [];
  return {
    collector_id: "git_sources",
    fingerprint: `git:${provider}:repo:${id}`,
    name: `${providerLabel} ${kindLabel} — ${fullName || name}`,
    category: "repository",
    provider,
    deployment_type: "repository",
    repository: fullName || name,
    github_access: provider === "github",
    running_status: "unknown",
    confidence_score:
      projectKind === "agent_project" ? 0.88 : workflowMatches?.length || assistedBy.length ? 0.84 : 0.78,
    framework: (extra.agentFrameworks || [])[0] || providerLabel,
    metadata: {
      connectorId: conn.id,
      connectorName: conn.name,
      discoveryMode: `${provider}-api-live`,
      inventoryClass: projectKind === "agent_project" ? "agent_project_repo" : "source_repository",
      evidenceClass: "repo_candidate",
      agentStatus: "candidate",
      projectKind: projectKind || "ai_signal_repo",
      provider,
      aiRelevant: true,
      webUrl,
      owner,
      languages,
      topics,
      workflowMatches,
      environment: conn.environment,
      ...buildAssistedByMetadata(assistedBy),
      ...extra
    },
    relationships: [
      {
        rel_type: "OBSERVED_BY",
        to_type: "GitProvider",
        to_key: `git-${provider}`,
        to_name: providerLabel
      },
      {
        rel_type: "RUNS_IN",
        to_type: "SourceRepository",
        to_key: `${provider}:${fullName || id}`,
        to_name: fullName || name
      },
      ...assistedBy.map((tool) => ({
        rel_type: "ASSISTED_BY",
        to_type: "AiAssistant",
        to_key: `assistant-${tool}`,
        to_name: tool
      }))
    ]
  };
}

export async function validateGithub({ config = {}, secrets = {} }) {
  const token = requireToken(secrets, "GitHub");
  const { base, policy } = githubBase(config);
  const user = await jsonFetch(
    `${base}/user`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    },
    policy
  );
  return { ok: true, message: `Authenticated to GitHub as ${user.login || "token user"}.` };
}

async function githubRepoSignals(base, policy, token, repo) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  const [owner, name] = String(repo.full_name || "").split("/");
  const languages = await jsonFetch(`${base}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/languages`, { headers }, policy, {
    optional: true
  }).catch(() => ({}));
  const workflowMatches = [];
  const agentMarkers = [];
  const dependencyHints = [];
  const mcpServers = [];
  const frameworks = new Set();
  const workflows = await jsonFetch(
    `${base}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/.github/workflows`,
    { headers },
    policy,
    { optional: true }
  ).catch(() => null);
  for (const file of Array.isArray(workflows) ? workflows.slice(0, 12) : []) {
    if (!/\.(ya?ml)$/i.test(file.name || "")) continue;
    const raw = await textFetch(
      `${base}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/.github/workflows/${encodeURIComponent(file.name)}`,
      { headers: { ...headers, Accept: "application/vnd.github.raw" } },
      policy,
      { optional: true }
    ).catch(() => null);
    if (raw && (isAiRelevantText(file.name, raw) || /agent|langchain|mcp|ollama|crewai/i.test(raw))) {
      workflowMatches.push(file.name);
      detectAgentFrameworks(raw).forEach((f) => frameworks.add(f));
    }
  }

  // Agent / assistant instruction markers + MCP / framework manifests
  const markerPaths = [
    ...AGENT_FILE_MARKERS,
    ".github/copilot-instructions.md",
    ".github/agents",
    "AGENTS.md",
    "CLAUDE.md",
    ".cursorrules",
    ".cursor/rules",
    ".cursor/mcp.json",
    ".claude/settings.json",
    "copilot-instructions.md",
    "mcp.json",
    ".mcp.json",
    "langgraph.json"
  ];
  for (const marker of [...new Set(markerPaths)]) {
    const raw = await textFetch(
      `${base}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${marker}`,
      { headers: { ...headers, Accept: "application/vnd.github.raw" } },
      policy,
      { optional: true }
    ).catch(() => null);
    if (raw && String(raw).trim()) {
      agentMarkers.push(marker);
      detectAgentFrameworks(raw).forEach((f) => frameworks.add(f));
      if (/mcp\.json$/i.test(marker)) {
        try {
          const parsed = JSON.parse(raw);
          const servers = Object.keys(parsed.mcpServers || parsed.mcp?.servers || {});
          mcpServers.push(...servers);
        } catch {
          /* ignore */
        }
      }
    } else {
      const listing = await jsonFetch(
        `${base}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${marker}`,
        { headers },
        policy,
        { optional: true }
      ).catch(() => null);
      if (Array.isArray(listing) && listing.length) agentMarkers.push(marker);
    }
  }

  // Dependency manifests for agent frameworks / MCP SDKs
  for (const depFile of ["package.json", "requirements.txt", "pyproject.toml", "poetry.lock", "Pipfile"]) {
    const raw = await textFetch(
      `${base}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${depFile}`,
      { headers: { ...headers, Accept: "application/vnd.github.raw" } },
      policy,
      { optional: true }
    ).catch(() => null);
    if (!raw) continue;
    const hints = extractDependencyHints(raw);
    if (hints.length) {
      dependencyHints.push(...hints);
      agentMarkers.push(depFile);
      detectAgentFrameworks(raw).forEach((f) => frameworks.add(f));
    }
  }

  const assistedBy = [
    ...new Set([
      ...detectAssistedByFromMarkers(agentMarkers),
      ...detectAssistedByFromText(agentMarkers.join(" "), workflowMatches.join(" "))
    ])
  ];

  return {
    languages: languages || {},
    workflowMatches,
    agentMarkers,
    dependencyHints: [...new Set(dependencyHints)],
    mcpServers: [...new Set(mcpServers)],
    agentFrameworks: [...frameworks],
    assistedBy
  };
}

export async function discoverGithub(conn) {
  const token = requireToken(conn.secrets || {}, "GitHub");
  const { base, policy } = githubBase(conn.config);
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  const orgOrUser = String(conn.config.orgOrUser || "").trim();
  let repos;
  if (orgOrUser) {
    repos = await pagedFetch(base, `/orgs/${encodeURIComponent(orgOrUser)}/repos?type=all`, { headers }, policy).catch(async (err) => {
      if (!/404|Not Found/i.test(err.message)) throw err;
      return pagedFetch(base, `/users/${encodeURIComponent(orgOrUser)}/repos?type=all`, { headers }, policy);
    });
  } else {
    repos = await pagedFetch(base, "/user/repos?affiliation=owner,collaborator,organization_member", { headers }, policy);
  }

  const observations = [];
  let aiRelevantRepos = 0;
  let agentProjects = 0;
  let assistedRepos = 0;
  for (const repo of repos) {
    const signals = await githubRepoSignals(base, policy, token, repo);
    const topics = repo.topics || [];
    const languageNames = Object.keys(signals.languages || {});
    const aiRelevant = isAiRelevantText(
      repo.name,
      repo.full_name,
      repo.description,
      topics.join(" "),
      languageNames.join(" "),
      signals.workflowMatches.join(" "),
      (signals.agentMarkers || []).join(" "),
      (signals.dependencyHints || []).join(" "),
      (signals.agentFrameworks || []).join(" "),
      (signals.assistedBy || []).join(" ")
    );
    if (!aiRelevant && !(signals.assistedBy || []).length && !(signals.agentFrameworks || []).length) continue;
    aiRelevantRepos += 1;
    const kind = classifyRepoProjectKind({
      agentMarkers: signals.agentMarkers || [],
      workflowMatches: signals.workflowMatches || [],
      frameworks: signals.agentFrameworks || [],
      dependencyHints: signals.dependencyHints || [],
      assistedBy: signals.assistedBy || [],
      mcpServers: signals.mcpServers || [],
      aiRelevant: true
    });
    if (kind.projectKind === "agent_project") agentProjects += 1;
    if ((signals.assistedBy || []).length) assistedRepos += 1;

    const howBits = [];
    if ((signals.agentFrameworks || []).length) howBits.push(`frameworks=${signals.agentFrameworks.slice(0, 4).join(",")}`);
    if ((signals.mcpServers || []).length) howBits.push(`mcp=${signals.mcpServers.slice(0, 4).join(",")}`);
    if ((signals.assistedBy || []).length) howBits.push(`assistedBy=${signals.assistedBy.join(",")}`);
    if ((signals.agentMarkers || []).length) howBits.push(`markers=${signals.agentMarkers.slice(0, 4).join(",")}`);

    observations.push(
      repoObservation({
        provider: "github",
        conn,
        id: repo.id || repo.full_name,
        name: repo.name,
        fullName: repo.full_name,
        webUrl: repo.html_url,
        owner: repo.owner?.login,
        languages: signals.languages || {},
        topics,
        workflowMatches: signals.workflowMatches,
        projectKind: kind.projectKind,
        extra: {
          private: repo.private,
          defaultBranch: repo.default_branch,
          agentMarkers: signals.agentMarkers || [],
          agentFrameworks: signals.agentFrameworks || [],
          dependencyHints: signals.dependencyHints || [],
          mcpServers: signals.mcpServers || [],
          assistedBy: signals.assistedBy || [],
          evidenceClass: "repo_candidate",
          agentStatus: "candidate",
          howIdentified: howBits.length
            ? `GitHub ${kind.projectKind || "ai_signal_repo"}: ${howBits.join("; ")}`
            : "GitHub repo name/description/topics match AI agent signals",
          githubAgentSignal: kind.githubAgentSignal
        }
      })
    );
  }

  return {
    observations,
    stats: {
      reposScanned: repos.length,
      aiRelevantRepos,
      agentProjects,
      assistedRepos,
      reposIngested: observations.length
    }
  };
}

export async function validateGitlab({ config = {}, secrets = {} }) {
  const token = requireToken(secrets, "GitLab");
  const { base, host, policy } = gitlabBase(config);
  const user = await jsonFetch(`${base}/user`, { headers: { "PRIVATE-TOKEN": token, Accept: "application/json" } }, policy);
  return { ok: true, message: `Authenticated to GitLab ${host} as ${user.username || user.name || "token user"}.` };
}

async function gitlabRepoSignals(base, policy, token, project) {
  const headers = { "PRIVATE-TOKEN": token, Accept: "application/json" };
  const projectId = encodeURIComponent(project.id);
  const languages = await jsonFetch(`${base}/projects/${projectId}/languages`, { headers }, policy, { optional: true }).catch(() => ({}));
  const workflowMatches = [];
  const agentMarkers = [];
  const dependencyHints = [];
  const frameworks = new Set();
  const branch = project.default_branch || "main";
  const ci = await textFetch(
    `${base}/projects/${projectId}/repository/files/${encodeURIComponent(".gitlab-ci.yml")}/raw?ref=${encodeURIComponent(branch)}`,
    { headers },
    policy,
    { optional: true }
  ).catch(() => null);
  if (ci && (isAiRelevantText(ci) || /agent|langchain|mcp|ollama|crewai/i.test(ci))) {
    workflowMatches.push(".gitlab-ci.yml");
    detectAgentFrameworks(ci).forEach((f) => frameworks.add(f));
  }

  for (const marker of ["AGENTS.md", "CLAUDE.md", ".cursorrules", ".cursor/mcp.json", "mcp.json", "package.json", "requirements.txt", "pyproject.toml"]) {
    const raw = await textFetch(
      `${base}/projects/${projectId}/repository/files/${encodeURIComponent(marker)}/raw?ref=${encodeURIComponent(branch)}`,
      { headers },
      policy,
      { optional: true }
    ).catch(() => null);
    if (!raw) continue;
    agentMarkers.push(marker);
    const hints = extractDependencyHints(raw);
    dependencyHints.push(...hints);
    detectAgentFrameworks(raw).forEach((f) => frameworks.add(f));
  }

  const assistedBy = [
    ...new Set([
      ...detectAssistedByFromMarkers(agentMarkers),
      ...detectAssistedByFromText(agentMarkers.join(" "))
    ])
  ];

  return {
    languages: languages || {},
    workflowMatches,
    agentMarkers,
    dependencyHints: [...new Set(dependencyHints)],
    agentFrameworks: [...frameworks],
    mcpServers: [],
    assistedBy
  };
}

export async function discoverGitlab(conn) {
  const token = requireToken(conn.secrets || {}, "GitLab");
  const { base, policy } = gitlabBase(conn.config);
  const headers = { "PRIVATE-TOKEN": token, Accept: "application/json" };
  const projectGroup = String(conn.config.projectGroup || "").trim();
  const path = projectGroup
    ? `/groups/${encodeURIComponent(projectGroup)}/projects?include_subgroups=true&with_shared=false`
    : "/projects?membership=true&simple=false";
  const projects = await pagedFetch(base, path, { headers }, policy);
  const observations = [];
  let aiRelevantRepos = 0;
  let agentProjects = 0;
  let assistedRepos = 0;

  for (const project of projects) {
    const signals = await gitlabRepoSignals(base, policy, token, project);
    const topics = project.topics || project.tag_list || [];
    const languageNames = Object.keys(signals.languages || {});
    const aiRelevant = isAiRelevantText(
      project.name,
      project.path_with_namespace,
      project.description,
      topics.join(" "),
      languageNames.join(" "),
      signals.workflowMatches.join(" "),
      (signals.agentMarkers || []).join(" "),
      (signals.dependencyHints || []).join(" "),
      (signals.assistedBy || []).join(" ")
    );
    if (!aiRelevant && !(signals.assistedBy || []).length && !(signals.agentFrameworks || []).length) continue;
    aiRelevantRepos += 1;
    const kind = classifyRepoProjectKind({
      agentMarkers: signals.agentMarkers || [],
      workflowMatches: signals.workflowMatches || [],
      frameworks: signals.agentFrameworks || [],
      dependencyHints: signals.dependencyHints || [],
      assistedBy: signals.assistedBy || [],
      mcpServers: signals.mcpServers || [],
      aiRelevant: true
    });
    if (kind.projectKind === "agent_project") agentProjects += 1;
    if ((signals.assistedBy || []).length) assistedRepos += 1;
    observations.push(
      repoObservation({
        provider: "gitlab",
        conn,
        id: project.id,
        name: project.name,
        fullName: project.path_with_namespace,
        webUrl: project.web_url,
        owner: project.namespace?.full_path || null,
        languages: signals.languages || {},
        topics,
        workflowMatches: signals.workflowMatches,
        projectKind: kind.projectKind,
        extra: {
          visibility: project.visibility,
          defaultBranch: project.default_branch,
          agentMarkers: signals.agentMarkers || [],
          agentFrameworks: signals.agentFrameworks || [],
          dependencyHints: signals.dependencyHints || [],
          assistedBy: signals.assistedBy || [],
          githubAgentSignal: kind.githubAgentSignal,
          howIdentified: `GitLab ${kind.projectKind || "ai_signal_repo"}`
        }
      })
    );
  }

  return {
    observations,
    stats: {
      reposScanned: projects.length,
      aiRelevantRepos,
      agentProjects,
      assistedRepos,
      reposIngested: observations.length
    }
  };
}

export const GIT_VALIDATORS = {
  github: validateGithub,
  gitlab: validateGitlab
};

export const GIT_DISCOVERERS = {
  github: discoverGithub,
  gitlab: discoverGitlab
};

export async function discoverGitSourceConnector(conn) {
  const discoverer = GIT_DISCOVERERS[conn.provider];
  if (!discoverer) throw new Error(`No Git discoverer for provider ${conn.provider}`);
  return discoverer(conn);
}
