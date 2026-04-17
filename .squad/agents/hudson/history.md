# Hudson — History

## Onboarding
- **Project:** ghcopilot-pii-demo — Live GHAS demo orchestration platform
- **Stack:** TypeScript, Express 4.18.2, SQLite, Octokit v21, GitHub Actions
- **User:** Saurabh
- **Joined:** 2026-04-17
- **Context:** Platform already has: CVE feed service, zero-day intelligence, Jira bridge with dedup, governance checks with PR gates, vulnerability trends with MTTR tracking, 3 GitHub Actions workflows (bridge, closer, governance-gate). Hudson's job is to tie all these into a single automated remediation pipeline.
- **Key existing files:**
  - src/mcp-server/jira-client.ts — Jira Cloud + Mock client
  - src/mcp-server/dedup-service.ts — Duplicate ticket prevention
  - src/services/governance-service.ts — 6 PR gate checks
  - src/services/vuln-trends-service.ts — Remediation event tracking
  - src/api/github-client.ts — Octokit wrapper (GitHubResult<T> pattern)
  - .github/workflows/ghas-jira-bridge.yml — GHAS alert → Jira ticket
  - .github/workflows/ghas-jira-closer.yml — Alert resolved → close ticket
  - .github/workflows/governance-gate.yml — PR governance checks

## Learnings
- **Pipeline types foundation (2026-04-17):** Created `src/services/pipeline-types.ts` with all 12-step types, discriminated union for step outputs (`StepOutputMap`), valid-transitions map, config defaults, events, dashboard summary, and type guards. Used lowercase `Severity` rather than reusing `CVESeverity` (uppercase) from `cve-types.ts` because the pipeline domain uses lowercase throughout; a mapping util can bridge later. Compiles cleanly with `npx tsc --noEmit`.
- **Pipeline engine + routes (2026-04-17):** Built `src/services/remediation-pipeline.ts` (RemediationPipeline class) and `src/api/pipeline-routes.ts` (10 REST endpoints + SSE). Key decisions: dryRun=true by default for demo safety; `FixedBy='pipeline'` maps to `'human'` when feeding into VulnEvent since vuln-trends-types doesn't include `'pipeline'`; EventEmitter wildcard pattern (`'*'`) for SSE broadcast; singleton export `pipeline` for shared state. Compiles cleanly.
