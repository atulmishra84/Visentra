import { pool } from "../db/postgres.js";
import { publicErrorMessage } from "../utils/http.js";
import {
  approveBaseline,
  assignControl,
  assuranceSummary,
  evaluateAgent,
  getAgentAssurance,
  recordPermissionSnapshot,
  recordRuntimeEvents,
  unassignControl
} from "../assurance/service.js";
import { ASSURANCE_CONTROLS } from "../assurance/effectiveness.js";

function actor(req) {
  return req.user?.email || req.user?.sub || null;
}

function fail(res, err, fallback) {
  res.status(err.status || 500).json({ error: { message: publicErrorMessage(err, fallback) } });
}

export async function catalog(_req, res) {
  res.json({ controls: ASSURANCE_CONTROLS });
}

export async function summary(req, res) {
  try {
    res.json(await assuranceSummary(pool, req.tenantId));
  } catch (err) {
    fail(res, err, "Unable to load control assurance");
  }
}

export async function detail(req, res) {
  try {
    res.json(await getAgentAssurance(pool, req.tenantId, req.params.agentId));
  } catch (err) {
    fail(res, err, "Unable to load agent assurance");
  }
}

export async function assign(req, res) {
  try {
    const assignment = await assignControl(pool, req.tenantId, req.params.agentId, req.body || {}, actor(req));
    res.status(201).json({ assignment });
  } catch (err) {
    fail(res, err, "Unable to assign control");
  }
}

export async function unassign(req, res) {
  try {
    await unassignControl(pool, req.tenantId, req.params.agentId, req.params.controlId);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, "Unable to remove control");
  }
}

export async function permissions(req, res) {
  try {
    const snapshot = await recordPermissionSnapshot(pool, req.tenantId, req.params.agentId, req.body || {}, actor(req));
    res.status(201).json({ snapshot });
  } catch (err) {
    fail(res, err, "Unable to record permission snapshot");
  }
}

export async function events(req, res) {
  try {
    const saved = await recordRuntimeEvents(pool, req.tenantId, req.params.agentId, req.body || {});
    res.status(201).json({ events: saved });
  } catch (err) {
    fail(res, err, "Unable to record runtime event");
  }
}

export async function evaluate(req, res) {
  try {
    res.json(await evaluateAgent(pool, req.tenantId, req.params.agentId));
  } catch (err) {
    fail(res, err, "Unable to evaluate controls");
  }
}

export async function baseline(req, res) {
  try {
    const row = await approveBaseline(pool, req.tenantId, req.params.agentId, actor(req));
    res.status(201).json({ baseline: row });
  } catch (err) {
    fail(res, err, "Unable to approve baseline");
  }
}
