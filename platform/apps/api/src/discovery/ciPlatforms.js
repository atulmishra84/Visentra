import { safeFetch, assertAllowedUrl, ALLOW } from "../utils/http.js";
import { isAiRelevantText } from "./aiRelevance.js";

/**
 * CI / build-system agent discovery (Jenkins and similar).
 */

const CI_JOB_LIMIT = Number(process.env.CI_DISCOVERY_MAX_JOBS || 100);

function dynamicCiPolicy(rawUrl) {
  const parsed = assertAllowedUrl(rawUrl, { allowPrivate: true });
  return {
    allowHosts: [parsed.hostname],
    allowHostSuffixes: [],
    allowPrivate: true
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

function ciObservation({ provider, conn, id, name, framework, model, status, extra = {} }) {
  return {
    collector_id: "ci_platform",
    fingerprint: `ci:${provider}:job:${id}`,
    name,
    category: "ci",
    provider,
    deployment_type: "ci",
    framework: framework || "Jenkins",
    model: model || "ci-ai-agent",
    running_status: status || "unknown",
    confidence_score: 0.78,
    metadata: {
      connectorId: conn.id,
      connectorName: conn.name,
      discoveryMode: "jenkins-api-live",
      inventoryClass: "ci_ai_job",
      evidenceClass: "repo_candidate",
      agentStatus: "candidate",
      aiRelevant: true,
      environment: conn.environment,
      ...extra
    },
    relationships: [
      {
        rel_type: "RUNS_IN",
        to_type: "CIPlatform",
        to_key: `ci-${provider}`,
        to_name: "Jenkins"
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
    const strong =
      /langchain|crewai|autogen|openai|anthropic|claude|copilot|bedrock|mcp|agent/i.test(
        `${job.name} ${job.description || ""} ${configXml.slice(0, 2000)}`
      );
    observations.push(
      ciObservation({
        provider: "jenkins",
        conn,
        id: job.url || job.name,
        name: `Jenkins AI job — ${job.fullName || job.name}`,
        framework: job._class || "Jenkins Job",
        model: strong ? "ci-ai-agent" : "ci-ai-candidate",
        status: job.color?.includes("anime") ? "running" : job.color === "disabled" ? "disabled" : "unknown",
        extra: {
          jobName: job.name,
          jobUrl: job.url,
          jobClass: job._class,
          evidenceClass: "repo_candidate",
          agentStatus: strong ? "candidate" : "candidate",
          aiSignal: strong ? "job-config-strong" : "job-name-heuristic",
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

export const CI_VALIDATORS = {
  jenkins: validateJenkins
};

export const CI_DISCOVERERS = {
  jenkins: discoverJenkins
};

export async function discoverCiConnector(conn) {
  const discoverer = CI_DISCOVERERS[conn.provider];
  if (!discoverer) throw new Error(`No CI discoverer for provider ${conn.provider}`);
  return discoverer(conn);
}
