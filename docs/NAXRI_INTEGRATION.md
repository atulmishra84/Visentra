# Visentra → NAXRI agent feed

Visentra discovers AI agents. NAXRI consumes that inventory for AI Security Posture Management.

## Modes

1. **Push (recommended)** — After each discovery job (when enabled), Visentra POSTs an inventory snapshot to the NAXRI webhook configured in **Settings → NAXRI ASPM**.
2. **Pull** — NAXRI polls `GET /api/integrations/naxri/feed` with a Visentra JWT.

## Configure in Visentra

1. Open **Settings → NAXRI ASPM**
2. Set your **real** NAXRI AISPM webhook URL, e.g. `https://<naxri-host>/api/v1/visentra/agents`  
   Do **not** use `example.com` placeholders — Test/Sync will fail with HTTP 405/HTML.
3. Optional API key (sent as `Authorization: Bearer …` and `X-Api-Key`)
4. Enable integration + auto-push
5. **Test connection**, then **Sync now**

If Test fails with HTML / “Example Domain”, the webhook is wrong — paste the ingest URL from NAXRI AISPM settings.

## API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/integrations/naxri` | Read config |
| `PUT` | `/api/integrations/naxri` | Upsert config |
| `GET` | `/api/integrations/naxri/feed` | Pull feed (for NAXRI) |
| `POST` | `/api/integrations/naxri/sync` | Push now |
| `POST` | `/api/integrations/naxri/test` | Probe webhook |

## Payload (`visentra.naxri.agent_feed/1.0`)

Inventory snapshot/delta JSON with `agents[]` containing agent_id, fingerprint, name, category, framework, model, tools, mcp_connections, risk_indicators, confidence, and last_seen_at.

## Local / private NAXRI

```bash
export NAXRI_ALLOW_HTTP=true
export NAXRI_ALLOW_PRIVATE=true
export NAXRI_ALLOW_HOSTS=naxri.local
```
