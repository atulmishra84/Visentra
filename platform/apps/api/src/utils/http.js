import https from "https";

/**
 * Outbound HTTP helpers: HTTPS-only, host allowlists, timeouts, no redirects.
 */

const DEFAULT_TIMEOUT_MS = Number(process.env.OUTBOUND_FETCH_TIMEOUT_MS || 25_000);

const PRIVATE_HOST_RE =
  /^(localhost|.*\.localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|::1|\[::1\])$/i;

export const ALLOW = {
  microsoftLogin: {
    allowHosts: ["login.microsoftonline.com"]
  },
  azureArm: {
    allowHosts: ["management.azure.com"]
  },
  /** Azure AI Foundry / AI Services data plane (Agents API). */
  azureAiServices: {
    allowHostSuffixes: [".services.ai.azure.com", ".cognitiveservices.azure.com"]
  },
  /** Azure OpenAI Assistants API hosts. */
  azureOpenAi: {
    allowHostSuffixes: [".openai.azure.com"]
  },
  /** AKS managed cluster API servers. */
  azureAks: {
    allowHostSuffixes: [".azmk8s.io", ".privatelink.azmk8s.io"],
    allowPrivate: false
  },
  aws: {
    allowHostSuffixes: [".amazonaws.com"]
  },
  googleApis: {
    allowHostSuffixes: [".googleapis.com"]
  },
  github: {
    allowHosts: ["api.github.com", "github.com"],
    allowHostSuffixes: [".github.com"]
  },
  gitlab: {
    allowHosts: ["gitlab.com"],
    allowHostSuffixes: [".gitlab.com"]
  },
  kubernetes: {
    allowPrivate: true
  },
  crowdstrike: {
    allowHosts: [
      "api.crowdstrike.com",
      "api.us-2.crowdstrike.com",
      "api.eu-1.crowdstrike.com",
      "api.laggar.gcw.crowdstrike.com",
      "api.us-gov-1.crowdstrike.com"
    ],
    allowHostSuffixes: [".crowdstrike.com"]
  },
  salesforce: {
    allowHosts: ["login.salesforce.com", "test.salesforce.com"],
    allowHostSuffixes: [".salesforce.com", ".force.com", ".my.salesforce.com"]
  },
  graphMicrosoft: {
    allowHosts: ["graph.microsoft.com"]
  },
  defender: {
    allowHosts: ["api.security.microsoft.com", "api.securitycenter.microsoft.com"]
  },
  netskope: {
    allowHostSuffixes: [".goskope.com"]
  },
  cortex: {
    allowHostSuffixes: [".paloaltonetworks.com"]
  },
  workday: {
    allowHostSuffixes: [".workday.com", ".myworkday.com"]
  },
  servicenow: {
    allowHostSuffixes: [".service-now.com"]
  },
  openai: {
    allowHosts: ["api.openai.com"],
    allowHostSuffixes: [".openai.com"]
  },
  jenkins: {
    // Self-hosted Jenkins uses dynamic allowHosts via assertAllowedUrl + allowPrivate
    allowPrivate: true,
    allowHostSuffixes: [".jenkins.io"]
  }
};

function hostMatches(hostname, { allowHosts = [], allowHostSuffixes = [] } = {}) {
  const host = String(hostname || "").toLowerCase();
  if (allowHosts.some((h) => h.toLowerCase() === host)) return true;
  return allowHostSuffixes.some((suffix) => {
    const s = suffix.startsWith(".") ? suffix.toLowerCase() : `.${suffix.toLowerCase()}`;
    return host === s.slice(1) || host.endsWith(s);
  });
}

/**
 * Validate an outbound URL before fetch. Throws on violation.
 * @returns {URL}
 */
export function assertAllowedUrl(input, policy = {}) {
  let parsed;
  try {
    parsed = new URL(String(input));
  } catch {
    throw new Error("Invalid outbound URL");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Only HTTPS outbound URLs are allowed");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Credentials in outbound URLs are not allowed");
  }

  const host = parsed.hostname.toLowerCase();
  if (!host) {
    throw new Error("Blocked outbound host: (empty)");
  }
  const ipOrPrivateHost = PRIVATE_HOST_RE.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host);
  if (!policy.allowPrivate && ipOrPrivateHost) {
    throw new Error(`Blocked outbound host: ${host || "(empty)"}`);
  }

  if ((policy.allowHosts?.length || policy.allowHostSuffixes?.length) && !hostMatches(host, policy)) {
    throw new Error(`Outbound host not in allowlist: ${host}`);
  }

  return parsed;
}

function headersObject(headers = {}) {
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

function bodyToBuffer(body) {
  if (body == null) return null;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  return Buffer.from(String(body));
}

function responseHeaders(rawHeaders = {}) {
  const headers = {};
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (value == null) continue;
    headers[key] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return headers;
}

function fetchWithHttpsRequest(url, init, timeoutMs) {
  const method = init.method || "GET";
  const body = bodyToBuffer(init.body);
  const headers = headersObject(init.headers);
  if (body && headers["content-length"] == null && headers["Content-Length"] == null) {
    headers["Content-Length"] = String(body.length);
  }

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        headers,
        rejectUnauthorized: init.skipTlsVerify ? false : undefined
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            reject(new Error(`Outbound redirects are not allowed (${url.hostname})`));
            return;
          }
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode || 599,
              statusText: res.statusMessage || "",
              headers: responseHeaders(res.headers)
            })
          );
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Outbound request timed out after ${timeoutMs}ms (${url.hostname})`));
    });
    init.signal?.addEventListener("abort", () => req.destroy(new Error("Outbound request aborted")), { once: true });
    if (body) req.write(body);
    req.end();
  });
}

/**
 * fetch() with HTTPS allowlist, timeout, and redirect rejection.
 */
export async function safeFetch(input, init = {}, policy) {
  if (!policy || (!(policy.allowHosts?.length) && !(policy.allowHostSuffixes?.length) && !policy.allowPrivate)) {
    throw new Error("Outbound fetch requires an allowlist policy");
  }
  const url = assertAllowedUrl(input, policy);
  const timeoutMs = init.timeoutMs ?? policy.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { timeoutMs: _drop, ...rest } = init;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchWithHttpsRequest(url, { ...rest, signal: rest.signal ?? controller.signal }, timeoutMs);
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`Outbound request timed out after ${timeoutMs}ms (${url.hostname})`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Reject path-injection / SSRF via hostname labels (tenant, instance, fqdn). */
export function assertDnsLabel(value, field = "value") {
  const v = String(value || "").trim();
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(v)) {
    throw new Error(`Invalid ${field}: must be a single DNS label`);
  }
  return v;
}

export function publicErrorMessage(err, fallback = "Request failed") {
  if (process.env.NODE_ENV !== "production") {
    return err?.message || fallback;
  }
  if (err?.status && err.status < 500 && err.message) {
    return err.message;
  }
  // Known safe operator-facing messages (validation / allowlist)
  const msg = String(err?.message || "");
  if (
    /required|invalid|not found|not allowed|allowlist|timed out|Unauthorized|Forbidden|already running/i.test(
      msg
    )
  ) {
    return msg;
  }
  return fallback;
}
