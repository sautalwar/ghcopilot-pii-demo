# GHAS MCP Server — Session Recovery Document
**Saved:** 2026-04-17T07:36Z
**Session ID:** 9d63cbd3-f8b3-49aa-b897-6817b85b4781

---

## Quick Recovery Guide

If your session was lost, tell the new session:
> "Restore from checkpoint 005 in `.copilot/session-state/9d63cbd3-f8b3-49aa-b897-6817b85b4781/checkpoints/005-wave1-agents-launched.md`. The plan is in `plan.md` in the same directory. The project is a GHAS demo platform with 46 todos (32 done, 4 in-progress with Hicks/Hudson/Vasquez, 10 pending). Squad team uses Alien universe names."

---

## What's Built (Phase 1 — 100% Complete)

### 10 Backend Services (`src/services/`):
1. CVE Feed Service — GitHub Advisory DB + NVD aggregation
2. CVE Types — Shared type definitions
3. Dependency Inventory — package.json/lock parser, full transitive tree
4. Zero-Day Service — EPSS, CISA KEV, OSV, early disclosures
5. Exploitability — Code impact analysis, blast radius
6. Vuln Trends Service — SQLite event log, MTTR, reduction tracking
7. Vuln Trends Types — Shared types
8. Risk Exceptions Service — .ghas-policy.yml parser
9. Governance Service — .ghas-governance.yml engine
10. License Compliance Service — License audit, SBOM, violations

### 16 MCP Tools (`src/mcp-server/index.ts`):
Jira (6): search, create, comment, transition, get, link
Risk (3): check_exception, list_exceptions, expiring_soon
Governance (3): check_pr, get_policy, certification_report
License (4): audit, check_package, get_violations, sbom

### 39+ API Endpoints (5 route groups):
- `/api/cves/*` (6 endpoints)
- `/api/zero-day/*` (7 endpoints)
- `/api/trends/*` (9 endpoints)
- `/api/governance/*` (10 endpoints)
- `/api/jira/*` (5 endpoints)
- Plus: `/api/demos/*`, `/api/pii-demo/*`, `/api/health`

### 3 GitHub Actions Workflows:
- `ghas-jira-bridge.yml` — GHAS alert → Jira ticket
- `ghas-jira-closer.yml` — Alert resolved → close Jira
- `governance-gate.yml` — PR security gate

### 10 Frontend Dashboard Tabs (`public/index.html`):
Demo Control, PII Demo, Dependency Tree, Full Dep Tree, CVE Feed (SSE), Zero-Day Intel, Vuln Trends (Chart.js), Jira Bridge, Governance, + base panels

### 2 Policy Files:
- `.ghas-policy.yml` — Risk exceptions
- `.ghas-governance.yml` — Governance checks + license policy

---

## What's In Progress (Wave 1 — 3 agents running)

| Agent | Todo | What They're Building |
|-------|------|----------------------|
| Hicks | rbac-auth-service | `src/services/auth-service.ts`, `src/middleware/rbac.ts`, `src/api/auth-routes.ts`, `src/models/auth-types.ts`, `data/seed-users.json` |
| Hudson | pipeline-types | `src/services/pipeline-types.ts` — 12-step state machine types |
| Vasquez | vscode-extension-scaffold + copilot-extension-scaffold | `vscode-ghas-security/` and `copilot-ghas-extension/` directories |

---

## What's Remaining (10 pending todos)

| Todo | Blocked By | Owner |
|------|-----------|-------|
| rbac-auth-routes | rbac-auth-service | Hicks |
| rbac-route-guards | rbac-auth-service | Hicks |
| rbac-frontend-gating | rbac-auth-routes | Dallas |
| rbac-admin-panel | rbac-route-guards | Hicks |
| pipeline-service | pipeline-types | Hudson |
| pipeline-routes | pipeline-service | Hudson |
| pipeline-workflow | pipeline-service | Parker |
| vscode-extension-sidebar | vscode-extension-scaffold | Vasquez |
| vscode-extension-commands | vscode-extension-scaffold | Vasquez |
| copilot-extension-commands | copilot-extension-scaffold | Vasquez |

---

## Environment Setup

```bash
# Server
npm start                    # ts-node src/server.ts → port 3000
npm run build               # TypeScript compile to dist/

# Key env vars (.env — gitignored)
GITHUB_TOKEN=...
GITHUB_OWNER=sautalwar
GITHUB_REPO=ghcopilot-pii-demo
JIRA_MODE=cloud
JIRA_BASE_URL=https://saurabhtalwar.atlassian.net/
JIRA_EMAIL=sunnytalwar2019@gmail.com
JIRA_API_TOKEN=...
JIRA_PROJECT_KEY=VULN
```

---

## Squad Team (Alien Universe)

| Name | Role | Focus |
|------|------|-------|
| Ripley | Lead | Architecture, scope, code review |
| Kane | Backend Dev | APIs, database, services |
| Dallas | Frontend Dev | UI, components, index.html |
| Lambert | Tester | Tests, quality |
| Ash | Security & Deps | Threat modeling, dep analysis |
| Bishop | GHAS Expert | GitHub Advanced Security |
| Hicks | Security Architect | RBAC, JWT, access control |
| Hudson | Workflow Orchestration | 12-step remediation pipeline |
| Vasquez | Extension Engineer | VS Code + Copilot Extensions |
| Parker | Actions Expert | GitHub Actions workflows |

---

## Known Bugs
1. CVE `/api/cves/stats` — "Invalid time value" — null guard needed on `publishedAt` in `cve-feed-service.ts`
2. CVE `/api/cves/latest` — NVD 6-second rate limit timeout (not a code bug)
