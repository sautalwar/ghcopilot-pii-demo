# Ash — History

## Project Context
- TypeScript/Express GHAS demo platform
- Dependencies: @octokit/rest, better-sqlite3, cors, dotenv, express, uuid (+ dev deps: typescript, ts-node, @types/*)
- Workflows: dependency-check.yml, codeql-analysis.yml, secret-remediation.yml, pii-scanner.yml
- Demo incidents in src/demo-incidents/ include intentionally vulnerable files for GHAS demos
- Environment: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO required
- .copilotignore excludes .env, data/, *.sql, *.csv, cert files from Copilot context
- User: Saurabh

## Learnings
