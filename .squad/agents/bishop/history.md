# Bishop — History

## Project Context
- GHAS demo platform: simulates security incidents, shows GHAS detecting/remediating in real-time
- Demo orchestration via src/api/demo-routes.ts → github-client.ts (Octokit)
- Demo scenarios catalog: src/api/demo-definitions.ts (branch-based and dispatch-only)
- Intentionally vulnerable files in src/demo-incidents/ (+ remediated counterparts)
- Workflows: codeql-analysis.yml, secret-remediation.yml, pii-scanner.yml, dependency-check.yml, content-exclusion-validator.yml, audit-logger.yml
- Workflow pattern: detect → annotate → summarize → create tracking artifact (issue or PR)
- Setup: npm run setup enables GHAS, configures repo (requires gh CLI)
- User: Saurabh

## Learnings
