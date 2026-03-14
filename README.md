# GitHub Copilot Security POC — Live Demo

> Real-time incident simulation & remediation with GitHub Actions, GHAS, and Copilot security controls.

## 🎯 What This Demo Shows

This POC addresses enterprise customer concerns about GitHub Copilot security with **live, verifiable proof**:

| Demo | What Happens | How It's Detected | How It's Fixed |
|------|-------------|-------------------|----------------|
| 🔑 Secret Leak | Hardcoded API keys pushed | GHAS Secret Scanning | Auto-remediation PR |
| 👤 PII Exposure | SSNs/emails in source code | Custom PII Scanner workflow | Auto-redaction PR |
| 💉 SQL Injection | String concatenation in SQL | CodeQL Analysis | Parameterized queries |
| 📦 Vuln Dependencies | Outdated packages | Dependabot + npm audit | Version update PR |
| 🚫 Content Exclusion | .copilotignore validation | Validation workflow | Platform enforcement |
| 📋 Audit Trail | Security event logging | Audit pipeline | JSON report artifact |

## 🚀 Quick Start

```bash
# 1. Clone and install
git clone https://github.com/sautalwar/ghcopilot-pii-demo.git
cd ghcopilot-pii-demo
npm install

# 2. Configure
cp .env.example .env
# Edit .env with your GitHub PAT

# 3. Setup (enables GHAS, configures repo)
npm run setup

# 4. Start the demo server
npm start
# Open http://localhost:3000
```

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│  Web Presenter (public/index.html)              │
│  ┌───────┬──────────┬───────────┬────────────┐  │
│  │ Demos │ GHAS     │ Business  │ GitHub vs  │  │
│  │       │ Showcase │ vs Enter  │ Competitors│  │
│  └───┬───┴────┬─────┴─────┬────┴──────┬─────┘  │
│      │        │           │           │         │
│  ┌───▼────────▼───────────▼───────────▼─────┐   │
│  │  Express API (src/api/)                   │   │
│  │  POST /api/demos/:id/start               │   │
│  │  GET  /api/demos/:id/status              │   │
│  │  POST /api/demos/:id/remediate           │   │
│  │  POST /api/demos/:id/teardown            │   │
│  └──────────────┬───────────────────────────┘   │
│                 │ Octokit                        │
│  ┌──────────────▼───────────────────────────┐   │
│  │  GitHub API                               │   │
│  │  • Create branches (demo/*)               │   │
│  │  • Push incident files                    │   │
│  │  • Trigger workflow_dispatch              │   │
│  │  • Poll workflow status                   │   │
│  │  • Create remediation PRs                 │   │
│  │  • Teardown (delete branches/PRs/issues)  │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

## 📁 Project Structure

```
ghcopilot-pii-demo/
├── .github/
│   ├── workflows/          # 6 GitHub Actions workflows
│   │   ├── pii-scanner.yml
│   │   ├── secret-remediation.yml
│   │   ├── codeql-analysis.yml
│   │   ├── dependency-check.yml
│   │   ├── content-exclusion-validator.yml
│   │   └── audit-logger.yml
│   └── copilot-instructions.md
├── src/
│   ├── server.ts           # Express entry point
│   ├── api/
│   │   ├── demo-routes.ts  # REST API endpoints
│   │   ├── github-client.ts # Octokit wrapper
│   │   └── demo-definitions.ts
│   ├── services/
│   │   └── redaction-service.ts
│   ├── security/
│   │   ├── audit-logger.ts
│   │   ├── data-classifier.ts
│   │   └── encryption.ts
│   ├── models/
│   │   └── citizen.ts
│   └── demo-incidents/     # Deliberately vulnerable files
│       ├── secret-leak.ts
│       ├── pii-data-leak.ts
│       ├── sql-injection.ts
│       ├── vulnerable-package.json
│       ├── remediated-secret-leak.ts
│       ├── remediated-pii-data.ts
│       └── remediated-sql.ts
├── public/
│   └── index.html          # Interactive demo presenter
├── scripts/
│   ├── setup.ps1           # Initial setup
│   ├── teardown.ps1        # Full cleanup
│   └── demo-reset.ps1      # Quick reset between demos
├── docs/
│   ├── security-matrix.md
│   ├── multi-model-security.md
│   └── data-flow-diagram.md
└── package.json
```

## 🔄 Demo Flow

```
1. SIMULATE INCIDENT          2. DETECT                3. REMEDIATE           4. TEARDOWN
   ┌──────────────┐              ┌────────────┐           ┌────────────┐        ┌──────────┐
   │ Push "bad"   │──────────▶   │ Workflow   │──────▶    │ Push fix   │──▶     │ Delete   │
   │ code to      │              │ detects    │           │ Open PR    │        │ branch   │
   │ demo/ branch │              │ the issue  │           │ Show diff  │        │ Close PR │
   └──────────────┘              └────────────┘           └────────────┘        └──────────┘
```

## 🛡️ GitHub Advanced Security (GHAS)

This demo showcases GHAS features included with GitHub Enterprise:
- **Secret Scanning** — 200+ provider patterns, push protection
- **Code Scanning (CodeQL)** — Static analysis for vulnerabilities
- **Dependabot** — Automated dependency updates
- **Security Overview** — Org-level risk dashboard

## ⚠️ Security Notice

This repository intentionally contains **fake** secrets and PII for demonstration purposes:
- All SSNs use the `000-XX-XXXX` format (not real)
- All API keys are documented example keys (not valid)
- All PII data is synthetic (no real people)

## 📜 License

MIT — For demonstration purposes only.
