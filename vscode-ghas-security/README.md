# GHAS Security Dashboard — VS Code Extension

GitHub Advanced Security integration for VS Code. Provides a CVE feed, vulnerability trends, Jira bridge, governance checks, SBOM generation, and CodeLens annotations for vulnerable imports.

## Features

- **Sidebar Panel** — Activity bar icon with tabs for CVEs, Trends, and Jira tickets
- **CodeLens** — Inline annotations on `import`/`require` statements for vulnerable packages
- **Dependency Tree** — Tree view showing direct and transitive dependencies with vulnerability status (🔴🟡🟢)
- **Command Palette** — All GHAS actions available via `Ctrl+Shift+P`:
  - `GHAS: Scan for Vulnerabilities`
  - `GHAS: Create Jira Ticket`
  - `GHAS: Run Governance Check`
  - `GHAS: Show Dependency Tree`
  - `GHAS: Generate SBOM`
  - `GHAS: Show CVE Feed`
  - `GHAS: Show Vulnerability Trends`
- **Status Bar** — Shows current CVE count at a glance

## Prerequisites

- The GHAS Express API server running at `http://localhost:3000` (or configure a custom URL)
- Node.js 18+

## Setup

```bash
cd vscode-ghas-security
npm install
npm run build
```

To test locally, press `F5` in VS Code to launch an Extension Development Host.

## Configuration

Open VS Code Settings and search for `GHAS`:

| Setting | Default | Description |
|---------|---------|-------------|
| `ghas.server.url` | `http://localhost:3000` | GHAS API server URL |
| `ghas.jira.baseUrl` | — | Jira instance URL |
| `ghas.jira.email` | — | Jira account email |
| `ghas.jira.apiToken` | — | Jira API token |
| `ghas.jira.projectKey` | — | Default Jira project key |
| `ghas.github.token` | — | GitHub PAT for GHAS API |

## Architecture

The extension is a thin client that calls the Express API server for all data. No direct GitHub or Jira API calls are made from the extension itself — everything routes through the backend.

```
VS Code Extension  →  Express API (localhost:3000)  →  GitHub API / Jira API
```
