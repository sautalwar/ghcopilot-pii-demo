# Vasquez — History

## Onboarding
- **Project:** ghcopilot-pii-demo — Live GHAS demo orchestration platform
- **Stack:** TypeScript, Express 4.18.2, SQLite, Octokit v21, GitHub Actions
- **User:** Saurabh
- **Joined:** 2026-04-17
- **Context:** Platform has 10+ backend services, 39+ API endpoints, MCP server with 16 tools, 10-tab HTML dashboard. Vasquez builds two extensions that wrap this functionality for developer consumption:
  1. VS Code Extension — marketplace install, sidebar panels, CodeLens, command palette
  2. Copilot Extension — @ghas-security chat participant with slash commands
- **Key API endpoints the extensions consume:**
  - GET /api/cves/latest, /api/cves/stats, /api/cves/stream (SSE)
  - GET /api/zero-day/active-threats, /api/zero-day/early-disclosures
  - GET /api/trends/summary, /api/trends/timeline
  - POST /api/governance/check/:pr, GET /api/governance/licenses, /api/governance/licenses/sbom
  - POST /api/jira/bridge, GET /api/jira/tickets, /api/jira/stats
- **Jira config flow:** User enters credentials → stored in VS Code SecretStorage (encrypted) → passed as headers to Express API or used directly by Copilot Extension backend

## Learnings
- node-fetch v2 is required for CommonJS (`module: commonjs`) projects — v3 is ESM-only and breaks TypeScript extensions targeting commonjs.
- VS Code extensions need `@types/vscode` in devDependencies but must NOT bundle it — the VS Code runtime provides the `vscode` module at runtime.
- Copilot Extensions use SSE (`text/event-stream`) with `choices[].delta.content` JSON payloads, terminated by `data: [DONE]`.
- Inline HTML webviews with `postMessage` are the simplest sidebar pattern — no framework needed at scaffold stage.
- Both extensions compile independently from the main project via `npx tsc -p <dir>/tsconfig.json`.
- Sidebar webviews should use `var(--vscode-*)` CSS custom properties for theme-aware styling — hardcoded colors break in light themes.
- CodeLens providers need a cache + refresh timer to avoid hammering the API on every keystroke; 5-minute TTL with manual refresh works well.
- `DiagnosticCollection` entries must use `vscode.Uri`-based keys (per-document) — clearing and re-publishing on scan gives the cleanest UX in the Problems panel.
- Tree provider `contextValue` on TreeItems enables context menu contributions in `package.json` menus section — essential for "Create Jira Ticket" right-click.
- Copilot Extension message formatters should use markdown tables for structured data and code blocks for trees/charts — Copilot Chat renders these natively.
- `cisaKEV` flag on ZeroDayAlert is valuable for demo impact — highlights items that are in the CISA Known Exploited Vulnerabilities catalog.

## Wave 1 & 3 Completion (2026-04-17)
- **Status:** ✅ VS Code and Copilot Extension scaffolds complete. Features integrated.
- **Verification:** Extensions compile independently. Sidebar + CodeLens + Copilot handlers working.
- **Session artifacts:** .squad/orchestration-log/2026-04-17T0756-wave1-wave4.md.
