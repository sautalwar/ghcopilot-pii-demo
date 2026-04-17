# Parker — History

## Project Context
- GitHub Actions workflows in .github/workflows/
- Core demo workflows: pii-scanner.yml, secret-remediation.yml, codeql-analysis.yml, dependency-check.yml, content-exclusion-validator.yml, audit-logger.yml
- Squad workflows: squad-heartbeat.yml, squad-issue-assign.yml, squad-triage.yml, sync-squad-labels.yml
- Workflow pattern: detect → annotate → summarize → create tracking artifact (issue or PR)
- Demo orchestration triggers workflows via Octokit workflow_dispatch in src/api/github-client.ts
- Demo scenarios: branch-based (create branch, push files, trigger workflow) and dispatch-only (workflow_dispatch on main)
- Teardown script: scripts/teardown.ps1 cleans demo branches, PRs, issues, workflow runs
- User: Saurabh

## Learnings

### 2025-07-17 — Remediation Pipeline & Merge Gate Workflows
- Built `remediation-pipeline.yml` (6-job workflow): detect-and-triage → create-tickets → wait-for-fix → review-and-gate → merge-and-verify → report
- Built `pipeline-gate.yml` (5-job PR gate): security-scan → governance-check → license-check → test-suite → gate-verdict
- Pipeline mirrors the 12-step engine in `src/services/remediation-pipeline.ts` but maps to 6 Actions jobs for practical CI/CD
- Used `peter-evans/create-or-update-comment@v4` for PR/issue comments, `actions/github-script@v7` for API calls
- Concurrency groups prevent duplicate pipeline runs per alert
- Dry-run mode (default: true) simulates all external calls — safe for demos
- Express API calls use `${{ vars.DEMO_SERVER_URL }}` with `http://localhost:3000` fallback
- All jobs include `permissions:` blocks scoped to least privilege
- Poll loop in wait-for-fix: 20 attempts × 30s = 10min timeout, with `needs-human` label on timeout
- Gate verdict sets commit status via `repos.createCommitStatus` for branch protection integration
