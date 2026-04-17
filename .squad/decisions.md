# Squad Decisions

## Wave 1–4 Implementation (2026-04-17)

### RBAC & Auth Architecture
**Contributors:** Hicks  
**Decision:** RBAC auth layer uses bcryptjs (pure JS), HS256 JWT, seed users hashed in-memory, 8h token expiry. Wildcard patterns: iewer → *:read, security_admin → *.  
**Rationale:** bcryptjs avoids native compilation issues; HS256 simpler for demos; in-memory store removes auth DB dependency.

### Auth Route Guards
**Contributors:** Hicks  
**Decision:** optionalAuth middleware sets eq.user when valid token present, never blocks. Strict uthMiddleware reserved for auth endpoints only. Router-level guards on all 7 route groups; per-route equireRole/equirePermission on top.  
**Rationale:** Backward-compatible with unauthenticated demo usage; layered guards provide fine-grained control; demo vs data-read routes use role vs permission gating.

### Admin Panel
**Contributors:** Hicks  
**Decision:** User deactivation is soft-delete (ctive: boolean). Create allows system_admin and security_admin; PUT/DELETE/reset-password restricted to system_admin only. Added /api/auth/users/:id/activate for reactivation.  
**Rationale:** Audit trail preservation; role-based create but admin-only mutate; toggle UI needed reactivation endpoint.

### Pipeline Types & State Machine
**Contributors:** Hudson  
**Decision:** Used lowercase Severity in pipeline domain (not reusing CVESeverity from cve-types.ts). Config defaults: dryRun=true, retryLimit=3, escalationThreshold=4.  
**Rationale:** Domain-specific naming clarity; mapping util can bridge later; safe-by-default dry-run for demos.

### Pipeline Engine & Routes
**Contributors:** Hudson  
**Decision:** dryRun=true by default. FixedBy='pipeline' maps to 'human' for VulnEvent (vuln-trends-types doesn't include 'pipeline'). EventEmitter wildcard '*' for SSE broadcast.  
**Rationale:** Demo safety; type compatibility; single emit point for all connected SSE clients.

### Frontend Login & Role-Based Access
**Contributors:** Dallas  
**Decision:** JWT in sessionStorage (not localStorage), cleared on tab close. All etch() calls include Authorization header via getAuthHeaders(). Role-tab mapping: ROLE_TAB_ACCESS filters NAV_TABS.  
**Rationale:** Tab-scoped credentials; 401 auto-logout pattern; static role-to-tab matrix simplifies routing.

### VS Code Extension Architecture
**Contributors:** Vasquez  
**Decision:** node-fetch v2 for CommonJS projects. Extensions compile independently. Sidebar webviews use ar(--vscode-*) CSS custom properties. CodeLens includes 5-min TTL cache.  
**Rationale:** ESM-only v3 breaks TypeScript extensions; independent compilation enables standalone testing; theme-aware styling prevents light-theme breakage; cache prevents API hammering.

### Copilot Extension Features
**Contributors:** Vasquez  
**Decision:** SSE with choices[].delta.content JSON, terminated by [DONE]. Message formatters use markdown tables for structured data, code blocks for trees/charts.  
**Rationale:** SSE standard for Copilot; native markdown rendering; tables/blocks familiar to users.

### Remediation Pipeline Workflows
**Contributors:** Parker  
**Decision:** Pipeline mirrors 12-step engine to 6 Actions jobs: detect-and-triage → create-tickets → wait-for-fix → review-and-gate → merge-and-verify → report. Concurrency groups prevent duplicates. Poll timeout: 20 attempts × 30s = 10min, with 
eeds-human label on timeout.  
**Rationale:** 6 jobs balance simplicity and workflow granularity; concurrency prevents runaway; 10min timeout with human escalation covers realistic remediation windows.

### Merge Gate Workflow
**Contributors:** Parker  
**Decision:** 5-job gate: security-scan → governance-check → license-check → test-suite → gate-verdict. Gate verdict sets commit status via epos.createCommitStatus for branch protection integration.  
**Rationale:** Layered checks cover multiple compliance vectors; commit status integrates with GitHub native branch protection.

## Governance
- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
