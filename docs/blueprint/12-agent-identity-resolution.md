# 12 - Agent Identity Resolution

## Overview

Agent identity resolution determines whether normalized observations represent a new agent, an existing agent, a new instance of an existing agent, or a weak candidate. It is central to trust: false merges hide assets, while false splits inflate inventory. Visentra should prefer conservative merging with transparent confidence.

## Resolution Inputs

- Source-native IDs.
- Agent names and aliases.
- Repository relationships.
- Runtime locations.
- Framework identifiers.
- MCP client/server configuration.
- Model/provider configuration.
- Tool schemas.
- Device and identity relationships.
- Cloud resource and container metadata.
- Timestamps and source freshness.

## Resolution Outputs

- Canonical `agent_id`.
- Agent instance IDs.
- Confidence score.
- Confidence reasons.
- Relationship candidates.
- Possible duplicate links.
- Discovery events for new/update/merge/split candidates.

## Matching Hierarchy

| Match Type | Strength | Example |
|---|---|---|
| Source-native stable ID | Very high | SaaS agent ID, cloud managed agent ARN. |
| Repository + agent definition path/class | High | Same repo, same class, same config. |
| Runtime instance fingerprint | High | Same container image digest and command fingerprint. |
| MCP client config + workspace | Medium-high | Same IDE workspace and MCP server config. |
| Name + owner + repository | Medium | Same display name with same owner/repo. |
| Name only | Low | Never sufficient alone for merge. |

## Decision Matrix

| Evidence | Action |
|---|---|
| Strong ID match | Update existing agent. |
| Strong instance match, weak agent match | Create/update instance and attach if safe. |
| Multiple weak signals align | Merge if threshold met; otherwise candidate duplicate. |
| Conflicting strong signals | Do not merge; emit data quality event. |
| Low evidence but agentic signal present | Create low-confidence candidate. |

## Confidence Scoring

Confidence should combine:

- Classification confidence: is this an agent?
- Identity confidence: is this the same agent as existing record?
- Relationship confidence: is this edge valid?
- Freshness confidence: how recent are signals?

Example factors:

```text
classification = source_signal_weight + taxonomy_match + framework_specific_signal
identity = stable_id_weight + repo_runtime_alignment + owner_alignment - conflict_penalty
freshness = decay(last_seen_age)
overall = weighted_average(classification, identity, freshness)
```

## Merge Safety Rules

- Never merge solely on display name.
- Never merge across tenants.
- Require strong evidence for cross-environment merges.
- Preserve source-native aliases.
- Keep merge history for audit.
- If merge confidence drops after new evidence, mark possible split rather than auto-splitting without review in V1/V2.

## Possible Duplicates

Possible duplicates are visibility findings, not remediation tasks. They should expose:

- Candidate agent IDs.
- Matching evidence.
- Conflicting evidence.
- Suggested reason.
- Confidence.

Users can view them; V1/V2 do not need manual merge workflows unless scoped as metadata maintenance rather than governance.

## Ownership Resolution

Ownership can be inferred from:

- SaaS owner/admin field.
- Repository owner/maintainer.
- Device assigned user.
- Cloud tags.
- Identity executing runtime.
- IDE workspace user.
- Group/team metadata.

Ownership confidence should be separate from agent identity confidence.

## Instance Resolution

Agent instances should be created when the same canonical agent appears in multiple runtimes:

- Same framework-defined agent deployed in several containers.
- Same IDE agent used in several workspaces.
- Same SaaS agent visible in several tenants.
- Same local agent process on multiple devices.

## Auditability

Resolution decisions must record:

- Input observation IDs.
- Matching rules applied.
- Confidence score before/after.
- Service version.
- Timestamp.
- Resulting entity/relationship IDs.

## Related Documents

- [05-information-architecture.md](./05-information-architecture.md)
- [11-normalization-pipeline.md](./11-normalization-pipeline.md)
- [13-graph-data-model.md](./13-graph-data-model.md)
