# GitHub Copilot Instructions

## ⚠️ IMPORTANT: This file is NOT a security boundary

These instructions guide Copilot's behavior but are NOT deterministic.
The LLM may ignore, misinterpret, or bypass these rules.
**DO NOT rely on this file for security enforcement.**

Use code-level controls (redaction services, content exclusion, MCP output filtering)
for actual security guarantees.

---

## Build & Run

```bash
npm start          # Run server (ts-node src/server.ts) → http://localhost:3000
npm run build      # TypeScript compile to dist/
npm run dev        # Watch mode
npm run setup      # Enable GHAS, configure repo (requires `gh` CLI)
npm run teardown   # Delete demo branches, close demo PRs/issues, clean workflow runs
```

There is no test suite or linter configured.

## Architecture

This is a **live demo orchestration platform** that simulates security incidents on a real GitHub repo and shows GHAS detecting and remediating them in real-time.

### Two independent route groups on one Express server (`src/server.ts`)

1. **Demo orchestration** (`/api/demos` → `src/api/demo-routes.ts`)
   - Drives the GHAS demo: creates `demo/*` branches, pushes intentionally vulnerable files, triggers GitHub Actions workflows, then pushes remediations and opens PRs.
   - All GitHub interaction goes through `src/api/github-client.ts` (Octokit wrapper).
   - Demo scenarios are declared as a catalog in `src/api/demo-definitions.ts`. Each entry specifies its branch name, workflow file, incident files, and remediation files.

2. **PII runtime proof** (`/api/pii-demo` → `src/pii-demo/pii-routes.ts`)
   - Local SQLite database (`data/citizens.db`) with synthetic citizen records, seeded by `src/pii-demo/database.ts`.
   - Demonstrates that PII is redacted in-app before any external exposure.

### Supporting layers

- **`src/services/redaction-service.ts`** — Pure string-masking functions: `maskSSN`, `maskEmail`, `maskPhone`, `maskAddress`, `maskDOB`, `redactCitizen`, `identifyPIIFields`.
- **`src/security/audit-logger.ts`** — In-memory audit log (`logAccess`, `getAuditLog`, `getPIIAccessLog`).
- **`src/security/data-classifier.ts`** — Field-name + regex heuristic PII classifier with confidence levels.
- **`src/security/encryption.ts`** — AES-256-GCM field encryption; key from `ENCRYPTION_KEY` env var.
- **`src/models/citizen.ts`** — `Citizen`, `RedactedCitizen`, and `AuditLogEntry` type definitions.
- **`src/demo-incidents/`** — Intentionally vulnerable files AND their remediated counterparts. These are pushed to demo branches during live demos.

### Frontend

`public/index.html` is a single-file static presenter console (no framework). It calls `/api/demos/*` via fetch.

### GitHub Actions workflows (`.github/workflows/`)

Workflows follow a shared pattern: **detect → annotate → summarize → create tracking artifact** (issue or PR). Key workflows: `pii-scanner.yml`, `secret-remediation.yml`, `codeql-analysis.yml`, `dependency-check.yml`, `content-exclusion-validator.yml`, `audit-logger.yml`.

## PII Handling Rules (Best-Effort)

1. **Never output raw Social Security Numbers** in suggestions or chat responses.
2. **Always use parameterized queries** when writing SQL — never concatenate user input.
3. **Prefer the redaction service** when working with citizen data — import from `services/redaction-service`.
4. **Do not hardcode credentials** in source files — use environment variables from `.env`.
5. **When suggesting test data**, use obviously fake values (e.g., SSN: 000-00-0000).
6. **Log all PII access** through the audit logger at `security/audit-logger`.

## Code Patterns to Prefer

- Use `getAllCitizensRedacted()` over `getAllCitizens()` for external-facing code
- Use `maskSSN()`, `maskEmail()`, `maskPhone()` from `services/redaction-service`
- Wrap data access with audit logging from `security/audit-logger`

## Code Patterns to Avoid

- Direct SQL queries without parameterization
- Logging PII values to console in production code
- Returning raw citizen records from API endpoints without redaction option
- Storing PII in plain text configuration files

## Key Conventions

### Result types

`src/api/github-client.ts` returns `GitHubResult<T>` from every method:
```ts
{ success: true, data: T }
{ success: false, error: string, status?: number }
```

API route responses use `{ success, data, meta }` — `meta` carries provenance info (data source, redaction status).

### Demo definitions

New demos are added by appending to the `DemoScenario[]` array in `src/api/demo-definitions.ts`. Each entry references files in `src/demo-incidents/` that get base64-encoded at startup. Two styles exist:
- **Branch-based**: creates a `demo/*` branch, pushes incident files, triggers a workflow.
- **Dispatch-only** (`dispatchOnly: true`): triggers a `workflow_dispatch` on `main` without creating a branch.

### Environment variables

Required: `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`. Optional: `PORT` (default 3000), `ENCRYPTION_KEY`.

### Content exclusion

`.copilotignore` excludes `.env` files, `data/` (SQLite DBs), `*.sql`, `*.csv`, cert files, and specific demo-incident files that contain fake secrets/PII. Respect these boundaries.
