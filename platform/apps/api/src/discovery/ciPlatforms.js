import { safeFetch, assertAllowedUrl, ALLOW } from "../utils/http.js";
import { isAiRelevantText } from "./aiRelevance.js";

/**
 * CI / build-system agent discovery (Jenkins, GitHub Actions, GitLab CI).
 */

const CI_JOB_LIMIT = Number(process.env.CI_DISCOVERY_MAX_JOBS || 100);

const AGENTIC_CI_RE =
  /langchain|langgraph|crewai|autogen|openai|anthropic|claude|copilot|bedrock|mcp|agent|ollama|vllm|aider|windsurf|semantic.?kernel|n8n|dialogflow|foundry/i;

function dynamicCiPolicy(rawUrl) {
  const parsed = assertAllowedUrl(rawUrl, { allowPrivate: true });
  return {
    allowHosts: [parsed.hostname],
    allowHostSuffixes: [],
    allowPrivate: true
  };
}

function dynamicPublicPolicy(rawUrl, basePolicy = {}) {
  const parsed = assertAllowedUrl(rawUrl, { allowPrivate: basePolicy.allowPrivate });
  return {
    allowHosts: Array.from(new Set([parsed.hostname, ...(basePolicy.allowHosts || [])])),
    allowHostSuffixes: basePolicy.allowHostSuffixes || []
  };
}

function requireJenkinsConfig({ config = {}, secrets = {} }) {
  const baseUrl = String(config.baseUrl || "").trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("Jenkins baseUrl is required (e.g. https://jenkins.example.com)");
  const parsed = assertAllowedUrl(baseUrl, { allowPrivate: true });
  const username = String(config.username || "").trim();
  const apiToken = String(secrets.apiToken || secrets.password || "").trim();
  if (!apiToken) throw new Error("Jenkins apiToken (or password) is required");
  return {
    baseUrl: parsed.origin,
    username,
    apiToken,
    policy: dynamicCiPolicy(parsed.origin)
  };
}

function jenkinsAuthHeader(username, apiToken) {
  if (!username) return { Authorization: `Bearer ${apiToken}` };
  const token = Buffer.from(`${username}:${apiToken}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

function jobLooksAiAgent(job, configXml = "") {
  return isAiRelevantText(
    job.name,
    job.fullName,
    job.description,
    job._class,
    configXml,
    job.url
  );
}

function ciObservation({
  provider,
  conn,
  id,
  name,
  framework,
  model,
  status,
  platformName,
  discoveryMode,
  extra = {}
}) {
  const strong = AGENTIC_CI_RE.test(
    `${name} ${framework || ""} ${extra.configSnippet || ""} ${extra.workflowPath || ""}`
  );
  return {
    collector_id: "ci_platform",
    fingerprint: `ci:${provider}:job:${id}`,
    name,
    category: "ci",
    provider,
    deployment_type: "ci",
    framework: framework || platformName || provider,
    model: model || (strong ? "ci-ai-agent" : "ci-ai-candidate"),
    running_status: status || "unknown",
    confidence_score: strong ? 0.82 : 0.76,
    metadata: {
      connectorId: conn.id,
      connectorName: conn.name,
      discoveryMode: discoveryMode || `${provider}-api-live`,
      inventoryClass: "ci_ai_job",
      evidenceClass: "repo_candidate",
      agentStatus: "candidate",
      aiRelevant: true,
      aiSignal: strong ? "job-config-strong" : "job-name-heuristic",
      environment: conn.environment,
      ...extra
    },
    relationships: [
      {
        rel_type: "RUNS_IN",
        to_type: "CIPlatform",
        to_key: `ci-${provider}`,
        to_name: platformName || provider
      }
    ]
  };
}

export async function validateJenkins({ config = {}, secrets = {} }) {
  const cfg = requireJenkinsConfig({ config, secrets });
  const res = await safeFetch(
    `${cfg.baseUrl}/api/json?tree=nodeName,mode,numExecutors,jobs[name]`,
    {
      headers: {
        ...jenkinsAuthHeader(cfg.username, cfg.apiToken),
        Accept: "application/json"
      }
    },
    cfg.policy
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.message || json.error || `Jenkins API failed (${res.status})`);
  }
  const jobs = Array.isArray(json.jobs) ? json.jobs.length : 0;
  return {
    ok: true,
    message: `Authenticated to Jenkins ${cfg.baseUrl} (${json.nodeName || "controller"}; sample jobs ${jobs}).`,
    baseUrl: cfg.baseUrl,
    username: cfg.username,
    apiToken: cfg.apiToken,
    policy: cfg.policy
  };
}

async function fetchJobConfig(baseUrl, jobName, headers, policy) {
  const encoded = String(jobName)
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/job/");
  const res = await safeFetch(`${baseUrl}/job/${encoded}/config.xml`, { headers }, policy).catch(() => null);
  if (!res?.ok) return "";
  return res.text().catch(() => "");
}

export async function discoverJenkins(conn) {
  const result = await validateJenkins({ config: conn.config, secrets: conn.secrets });
  const observations = [];
  const headers = {
    ...jenkinsAuthHeader(result.username, result.apiToken),
    Accept: "application/json"
  };

  const listRes = await safeFetch(
    `${result.baseUrl}/api/json?tree=jobs[name,url,color,_class,description,fullName]`,
    { headers },
    result.policy
  );
  const listJson = await listRes.json().catch(() => ({}));
  if (!listRes.ok) {
    throw new Error(listJson.message || `Jenkins job list failed (${listRes.status})`);
  }

  const jobs = Array.isArray(listJson.jobs) ? listJson.jobs.slice(0, CI_JOB_LIMIT) : [];
  let aiJobs = 0;
  for (const job of jobs) {
    const configXml = await fetchJobConfig(result.baseUrl, job.name, headers, result.policy);
    if (!jobLooksAiAgent(job, configXml.slice(0, 4000))) continue;
    aiJobs += 1;
    observations.push(
      ciObservation({
        provider: "jenkins",
        conn,
        id: job.url || job.name,
        name: `Jenkins AI job — ${job.fullName || job.name}`,
        framework: job._class || "Jenkins Job",
        platformName: "Jenkins",
        discoveryMode: "jenkins-api-live",
        status: job.color?.includes("anime") ? "running" : job.color === "disabled" ? "disabled" : "unknown",
        extra: {
          jobName: job.name,
          jobUrl: job.url,
          jobClass: job._class,
          configSnippet: configXml.slice(0, 400)
        }
      })
    );
  }

  return {
    observations,
    stats: {
      jobsScanned: jobs.length,
      aiJobs,
      jobsIngested: observations.length,
      message: result.message
    }
  };
}

/* ---------------- GitHub Actions ---------------- */

function requireGithubActionsConfig({ config = {}, secrets = {} }) {
  const token = String(secrets.token || secrets.apiToken || "").trim();
  if (!token) throw new Error("GitHub Actions token is required");
  const org = String(config.org || config.owner || "").trim();
  const apiBase = String(config.apiBase || "https://api.github.com").replace(/\/+$/, "");
  const policy = dynamicPublicPolicy(apiBase, ALLOW.github);
  return { token, org, apiBase, policy };
}

export async function validateGithubActions({ config = {}, secrets = {} }) {
  const cfg = requireGithubActionsConfig({ config, secrets });
  const headers = {
    Authorization: `Bearer ${cfg.token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "Visentra-Discovery"
  };
  const who = await safeFetch(`${cfg.apiBase}/user`, { headers }, cfg.policy);
  const whoJson = await who.json().catch(() => ({}));
  if (!who.ok) throw new Error(whoJson.message || `GitHub auth failed (${who.status})`);
  if (cfg.org) {
    const orgRes = await safeFetch(`${cfg.apiBase}/orgs/${encodeURIComponent(cfg.org)}`, { headers }, cfg.policy);
    if (!orgRes.ok && orgRes.status !== 404) {
      const err = await orgRes.json().catch(() => ({}));
      throw new Error(err.message || `GitHub org check failed (${orgRes.status})`);
    }
  }
  return {
    ok: true,
    message: `Authenticated to GitHub as ${whoJson.login || "user"}${cfg.org ? ` (org ${cfg.org})` : ""}.`,
    ...cfg,
    headers
  };
}

async function listGithubRepos(cfg) {
  const headers = {
    Authorization: `Bearer ${cfg.token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "Visentra-Discovery"
  };
  const path = cfg.org
    ? `${cfg.apiBase}/orgs/${encodeURIComponent(cfg.org)}/repos?per_page=50&type=all&sort=updated`
    : `${cfg.apiBase}/user/repos?per_page=50&affiliation=owner,organization_member&sort=updated`;
  const res = await safeFetch(path, { headers }, cfg.policy);
  const json = await res.json().catch(() => []);
  if (!res.ok) throw new Error(json.message || `GitHub repos failed (${res.status})`);
  return Array.isArray(json) ? json.slice(0, CI_JOB_LIMIT) : [];
}

export async function discoverGithubActions(conn) {
  const result = await validateGithubActions({ config: conn.config, secrets: conn.secrets });
  const observations = [];
  const repos = await listGithubRepos(result);
  let workflowsScanned = 0;
  let aiJobs = 0;

  for (const repo of repos) {
    const owner = repo.owner?.login || result.org;
    const name = repo.name;
    if (!owner || !name) continue;
    const wfRes = await safeFetch(
      `${result.apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/actions/workflows?per_page=50`,
      { headers: result.headers },
      result.policy
    ).catch(() => null);
    if (!wfRes?.ok) continue;
    const wfJson = await wfRes.json().catch(() => ({}));
    const workflows = Array.isArray(wfJson.workflows) ? wfJson.workflows : [];
    workflowsScanned += workflows.length;

    for (const wf of workflows) {
      const path = wf.path || "";
      let content = "";
      if (path) {
        const fileRes = await safeFetch(
          `${result.apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${path
            .split("/")
            .map(encodeURIComponent)
            .join("/")}`,
          { headers: result.headers },
          result.policy
        ).catch(() => null);
        if (fileRes?.ok) {
          const fileJson = await fileRes.json().catch(() => ({}));
          if (fileJson.content && fileJson.encoding === "base64") {
            content = Buffer.from(fileJson.content, "base64").toString("utf8").slice(0, 5000);
          }
        }
      }
      const blob = `${wf.name || ""} ${path} ${repo.full_name || ""} ${content}`;
      if (!isAiRelevantText(blob) && !AGENTIC_CI_RE.test(blob)) continue;
      aiJobs += 1;
      observations.push(
        ciObservation({
          provider: "github_actions",
          conn,
          id: `${repo.full_name}:${wf.id || path || wf.name}`,
          name: `GitHub Actions — ${repo.full_name} / ${wf.name || path}`,
          framework: "GitHub Actions",
          platformName: "GitHub Actions",
          discoveryMode: "github-actions-api-live",
          status: wf.state === "active" ? "running" : wf.state || "unknown",
          extra: {
            jobName: wf.name,
            repository: repo.full_name,
            workflowPath: path,
            workflowId: wf.id,
            htmlUrl: wf.html_url || repo.html_url,
            configSnippet: content.slice(0, 400)
          }
        })
      );
    }
  }

  return {
    observations,
    stats: {
      jobsScanned: workflowsScanned,
      reposScanned: repos.length,
      aiJobs,
      jobsIngested: observations.length,
      message: result.message
    }
  };
}

/* ---------------- GitLab CI ---------------- */

function requireGitlabCiConfig({ config = {}, secrets = {} }) {
  const token = String(secrets.token || secrets.apiToken || "").trim();
  if (!token) throw new Error("GitLab CI token is required");
  const host = String(config.host || "gitlab.com")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  const group = String(config.group || config.namespace || "").trim();
  const base = `https://${host}/api/v4`;
  const policy = dynamicPublicPolicy(`https://${host}`, ALLOW.gitlab);
  return { token, host, group, base, policy };
}

export async function validateGitlabCi({ config = {}, secrets = {} }) {
  const cfg = requireGitlabCiConfig({ config, secrets });
  const headers = { "PRIVATE-TOKEN": cfg.token, Accept: "application/json" };
  const who = await safeFetch(`${cfg.base}/user`, { headers }, cfg.policy);
  const whoJson = await who.json().catch(() => ({}));
  if (!who.ok) throw new Error(whoJson.message || `GitLab auth failed (${who.status})`);
  return {
    ok: true,
    message: `Authenticated to GitLab ${cfg.host} as ${whoJson.username || whoJson.name || "user"}${
      cfg.group ? ` (group ${cfg.group})` : ""
    }.`,
    ...cfg,
    headers
  };
}

export async function discoverGitlabCi(conn) {
  const result = await validateGitlabCi({ config: conn.config, secrets: conn.secrets });
  const observations = [];
  const projectPath = result.group
    ? `${result.base}/groups/${encodeURIComponent(result.group)}/projects?per_page=50&include_subgroups=true&order_by=last_activity_at`
    : `${result.base}/projects?membership=true&per_page=50&order_by=last_activity_at&simple=true`;
  const projRes = await safeFetch(projectPath, { headers: result.headers }, result.policy);
  const projects = await projRes.json().catch(() => []);
  if (!projRes.ok) {
    throw new Error(projects.message || `GitLab projects failed (${projRes.status})`);
  }
  const list = Array.isArray(projects) ? projects.slice(0, CI_JOB_LIMIT) : [];
  let aiJobs = 0;

  for (const project of list) {
    const projectId = project.id;
    const pathWithNamespace = project.path_with_namespace || project.name;
    const ciRes = await safeFetch(
      `${result.base}/projects/${encodeURIComponent(projectId)}/repository/files/${encodeURIComponent(
        ".gitlab-ci.yml"
      )}/raw?ref=${encodeURIComponent(project.default_branch || "main")}`,
      { headers: result.headers },
      result.policy
    ).catch(() => null);
    let content = "";
    if (ciRes?.ok) content = (await ciRes.text().catch(() => "")).slice(0, 5000);
    const blob = `${pathWithNamespace} ${project.description || ""} ${content}`;
    if (!content && !isAiRelevantText(blob)) continue;
    if (!isAiRelevantText(blob) && !AGENTIC_CI_RE.test(blob)) continue;
    aiJobs += 1;
    observations.push(
      ciObservation({
        provider: "gitlab_ci",
        conn,
        id: `${projectId}:gitlab-ci`,
        name: `GitLab CI — ${pathWithNamespace}`,
        framework: "GitLab CI",
        platformName: "GitLab CI",
        discoveryMode: "gitlab-ci-api-live",
        status: "unknown",
        extra: {
          jobName: ".gitlab-ci.yml",
          repository: pathWithNamespace,
          projectId,
          webUrl: project.web_url,
          workflowPath: ".gitlab-ci.yml",
          configSnippet: content.slice(0, 400)
        }
      })
    );
  }

  return {
    observations,
    stats: {
      jobsScanned: list.length,
      aiJobs,
      jobsIngested: observations.length,
      message: result.message
    }
  };
}

export const CI_VALIDATORS = {
  jenkins: validateJenkins,
  github_actions: validateGithubActions,
  gitlab_ci: validateGitlabCi
};

export const CI_DISCOVERERS = {
  jenkins: discoverJenkins,
  github_actions: discoverGithubActions,
  gitlab_ci: discoverGitlabCi
};

export async function discoverCiConnector(conn) {
  const discoverer = CI_DISCOVERERS[conn.provider];
  if (!discoverer) throw new Error(`No CI discoverer for provider ${conn.provider}`);
  return discoverer(conn);
}
