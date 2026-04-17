# Work Routing

How to decide who handles what.

## Routing Table

| Work Type | Route To | Examples |
|-----------|----------|----------|
| Backend, APIs, Express, GitHub client | Kane | API routes, Octokit integration, demo orchestration, database |
| Frontend, UI, HTML, presenter console | Dallas | index.html, interactive demos, CSS, client-side JS |
| Security, PII, redaction, encryption | Kane + Lambert | Redaction service, data classifier, audit logging |
| Demo scenarios, workflows, Actions | Kane | demo-definitions, demo-incidents, workflow files |
| Code review | Ripley | Review PRs, check quality, suggest improvements |
| Architecture, scope, decisions | Ripley | What to build next, trade-offs, system design |
| Testing, edge cases, quality | Lambert | Write tests, find edge cases, verify fixes |
| CVEs, dependencies, @copilot workflow, PR gating | Ash | Dependency audits, CVE triage, assign to @copilot, gate PRs |
| GHAS, CodeQL, secret scanning, Dependabot | Bishop | CodeQL queries, secret patterns, GHAS config, security advisories |
| Actions, workflows, CI/CD, runners | Parker | Workflow authoring, debugging, reusable workflows, Actions infra |
| Session logging | Scribe | Automatic — never needs routing |

## Issue Routing

| Label | Action | Who |
|-------|--------|-----|
| `squad` | Triage: analyze issue, assign `squad:{member}` label | Lead |
| `squad:{name}` | Pick up issue and complete the work | Named member |

### How Issue Assignment Works

1. When a GitHub issue gets the `squad` label, the **Lead** triages it — analyzing content, assigning the right `squad:{member}` label, and commenting with triage notes.
2. When a `squad:{member}` label is applied, that member picks up the issue in their next session.
3. Members can reassign by removing their label and adding another member's label.
4. The `squad` label is the "inbox" — untriaged issues waiting for Lead review.

## Rules

1. **Eager by default** — spawn all agents who could usefully start work, including anticipatory downstream work.
2. **Scribe always runs** after substantial work, always as `mode: "background"`. Never blocks.
3. **Quick facts → coordinator answers directly.** Don't spawn an agent for "what port does the server run on?"
4. **When two agents could handle it**, pick the one whose domain is the primary concern.
5. **"Team, ..." → fan-out.** Spawn all relevant agents in parallel as `mode: "background"`.
6. **Anticipate downstream work.** If a feature is being built, spawn the tester to write test cases from requirements simultaneously.
7. **Issue-labeled work** — when a `squad:{member}` label is applied to an issue, route to that member. The Lead handles all `squad` (base label) triage.
