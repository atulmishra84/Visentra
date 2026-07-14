# 23 - Frontend Architecture

## Overview

The Visentra frontend is an enterprise web console for discovery, inventory, topology, search, analytics, timelines, exports, and settings. It should be fast, accessible, role-aware, and optimized for dense technical workflows.

## Recommended Stack

- React with TypeScript.
- Route-based code splitting.
- Data fetching with query caching.
- Component library for tables, filters, drawers, charts, and forms.
- Graph visualization library capable of large interactive topology.
- SSE/WebSocket client for realtime.

## Application Structure

```text
src/
├── app/
├── routes/
├── features/
│   ├── executive/
│   ├── operations/
│   ├── discovery/
│   ├── inventory/
│   ├── topology/
│   ├── search/
│   └── settings/
├── components/
├── api/
├── auth/
├── state/
├── charts/
├── graph/
└── utils/
```

## State Management

Use layered state:

- URL state for filters, search queries, selected entity, graph depth.
- Server cache for API data.
- Local component state for drawer open/closed, column widths, chart interactions.
- User preferences for density, columns, saved views.

## Data Fetching

Requirements:

- Cursor pagination.
- Abortable requests.
- Retry with backoff for transient errors.
- Stale-while-revalidate for dashboards.
- Explicit degraded states.
- RBAC-aware hidden/disabled controls.

## Realtime Client

Realtime sources:

- Discovery run updates.
- Collector health.
- Discovery events.
- Export lifecycle.
- Agent timeline.
- Topology changes.

Realtime rules:

- Pause/resume for event streams.
- Reconnect with cursor.
- Avoid surprise table reordering.
- Show connection status.

## Table Architecture

Tables need:

- Server-side sort/filter.
- Virtualization for large pages.
- Column manager.
- Density controls.
- Row selection.
- Detail drawer integration.
- Export current view.

## Graph Architecture

Graph UI should separate:

- Data loading.
- Layout calculation.
- Rendering.
- Interaction state.
- Selection/detail panels.

Large graphs require grouping and expansion, not unlimited rendering.

## Accessibility

- Keyboard navigation.
- Focus traps in drawers/modals.
- ARIA labels for charts/graphs.
- Color-independent status indicators.
- High contrast support.
- Reduced motion support.

## Related Documents

- [07-ui-screens.md](./07-ui-screens.md)
- [08-ui-widgets.md](./08-ui-widgets.md)
- [29-ux-guidelines.md](./29-ux-guidelines.md)
