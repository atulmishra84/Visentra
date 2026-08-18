# Dashboard HTML prototypes

Static click-through shells for Visentra AgentRadar dashboards. Styled with the product design tokens (IBM Plex, teal brand, dark navy surfaces).

## Open locally

From the web app (Vite serves `public/`):

```text
/prototypes/
/prototypes/executive.html
/prototypes/mesh.html
/prototypes/operations.html
/prototypes/shadow-ai.html
/prototypes/discovery.html
/prototypes/adversarial.html
/prototypes/inventory.html
```

Or open any file under `platform/apps/web/public/prototypes/` directly in a browser.

## Pages

| Page | Purpose |
|------|---------|
| `index.html` | Gallery entry |
| `executive.html` | Leadership KPIs, evidence/status mix, models, trend |
| `mesh.html` | SaaS / serverless / endpoint constellation |
| `operations.html` | Analyst queue with filter chips |
| `shadow-ai.html` | Unmanaged / unsanctioned agents |
| `discovery.html` | Connectors + recent jobs |
| `adversarial.html` | Attack-surface enrichment prototype |
| `phi-pii-exposure.html` | PHI/PII exposure across all scanners |
| `inventory.html` | Resource → agent → runtime inventory |

Mock data only — not wired to the API.
