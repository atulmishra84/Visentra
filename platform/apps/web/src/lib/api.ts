export type ApiError = Error & {
  status?: number;
  requestId?: string;
  details?: unknown;
};

export type Agent = Record<string, unknown> & {
  id?: string;
  name?: string;
  displayName?: string;
  owner?: string | { name?: string; id?: string };
  model?: string;
  framework?: string;
  cloud?: string;
  category?: string;
  department?: string;
      confidence?: number;
  confidence_score?: number;
  shadowAi?: boolean;
  shadowAiScore?: number;
  shadowAiReasons?: string[];
  shadowAiTags?: string[];
  lastObservedAt?: string;
  last_seen?: string;
};

export type GraphNode = Record<string, unknown> & {
  id: string;
  label?: string;
  type?: string;
  displayName?: string;
  name?: string;
};

export type GraphEdge = Record<string, unknown> & {
  id?: string;
  from?: string;
  to?: string;
  source?: string;
  target?: string;
  type?: string;
  label?: string;
};

export type GraphPayload = {
  nodes?: GraphNode[];
  edges?: GraphEdge[];
  relationships?: GraphEdge[];
  items?: unknown[];
  requestId?: string;
  meta?: {
    seed?: string | null;
    matched?: number;
    nodeCount?: number;
    edgeCount?: number;
    depth?: number;
    message?: string;
  };
};

const TOKEN_KEY = "agentradar.jwt";

export const API_BASE_URL = (
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8080"
).replace(/\/$/, "");

export function getAuthToken(): string | null {
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string | null): void {
  if (token) {
    window.localStorage.setItem(TOKEN_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_KEY);
  }
}

export function buildApiUrl(path: string, query?: Record<string, unknown>): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const base =
    API_BASE_URL.length > 0
      ? API_BASE_URL
      : typeof window !== "undefined"
        ? window.location.origin
        : "http://localhost:8080";
  const url = new URL(`${base}${normalizedPath}`);

  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }

    if (Array.isArray(value)) {
      value
        .filter((entry) => entry !== undefined && entry !== null && entry !== "")
        .forEach((entry) => url.searchParams.append(key, String(entry)));
      return;
    }

    url.searchParams.set(key, String(value));
  });

  return url.toString();
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { query?: Record<string, unknown> } = {}
): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(options.headers);

  if (!(options.body instanceof FormData) && !headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(buildApiUrl(path, options.query), {
    ...options,
    headers
  });

  const contentType = response.headers.get("content-type") ?? "";
  const requestId = response.headers.get("x-request-id") ?? undefined;
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: { message?: string } }).error?.message ?? response.statusText)
        : response.statusText;
    const error = new Error(message) as ApiError;
    error.status = response.status;
    error.requestId =
      requestId ??
      (payload && typeof payload === "object" && "requestId" in payload
        ? String((payload as { requestId?: string }).requestId)
        : undefined);
    error.details = payload;
    throw error;
  }

  return payload as T;
}

export async function downloadAgentExport(format: "csv" | "json", query?: Record<string, unknown>) {
  const token = getAuthToken();
  const response = await fetch(buildApiUrl("/api/export/agents", { ...query, format }), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });

  if (!response.ok) {
    throw new Error(`Export failed with ${response.status}`);
  }

  const blob = await response.blob();
  const href = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `agentradar-agents.${format}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(href);
}

export function connectGraphStream(
  onMessage: (event: MessageEvent) => void,
  onStatus?: (status: "connecting" | "live" | "error") => void
): EventSource {
  const token = getAuthToken();
  const url = buildApiUrl("/api/graph/stream", token ? { token } : undefined);
  onStatus?.("connecting");

  const source = new EventSource(url);
  source.onopen = () => onStatus?.("live");
  source.onerror = () => onStatus?.("error");

  [
    "graph.updated",
    "graph.edge.created",
    "inventory.agent.created",
    "inventory.agent.updated"
  ].forEach((eventName) => {
    source.addEventListener(eventName, onMessage as EventListener);
  });

  return source;
}

export function listFromPayload<T = Record<string, unknown>>(
  payload: unknown,
  preferredKeys: string[] = ["items", "agents", "jobs", "events", "results", "nodes"]
): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const objectPayload = payload as Record<string, unknown>;

  for (const key of preferredKeys) {
    const value = objectPayload[key];
    if (Array.isArray(value)) {
      return value as T[];
    }
  }

  return [];
}

export function valueAt(record: Record<string, unknown>, keys: string[], fallback = "Unknown"): string {
  for (const key of keys) {
    const value = record[key];
    if (value === undefined || value === null || value === "") {
      continue;
    }

    if (typeof value === "object" && "name" in value) {
      return String((value as { name?: unknown }).name ?? fallback);
    }

    if (Array.isArray(value)) {
      return value.map(String).join(", ");
    }

    return String(value);
  }

  return fallback;
}

export function numberAt(record: Record<string, unknown>, keys: string[], fallback = 0): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }

  return fallback;
}

export function compactDate(value: unknown): string {
  if (!value) {
    return "Never";
  }

  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
