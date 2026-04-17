# @ghas-security — GitHub Copilot Extension

A GitHub Copilot chat participant that provides GHAS security insights directly in the Copilot Chat panel.

## Slash Commands

| Command | Description |
|---------|-------------|
| `/scan` | Scan for vulnerabilities affecting repo dependencies |
| `/cves` | Show latest CVEs |
| `/jira` | List or search Jira tickets |
| `/jira create summary="Fix XSS" priority="High"` | Create a Jira ticket |
| `/governance` | Governance summary check |
| `/sbom` | Software Bill of Materials |
| `/zeroday` | Active zero-day alerts |
| `/trends` | Vulnerability trend summary |
| `/remediate` | Start remediation (coming soon) |

## Architecture

```
GitHub Copilot Chat  →  Copilot Extension (port 3001)  →  Express API (port 3000)  →  GitHub/Jira
```

The extension is an Express server that receives SSE-formatted requests from GitHub Copilot, routes them to the appropriate handler, calls the main GHAS API server, and returns markdown-formatted responses.

## Setup

```bash
cd copilot-ghas-extension
npm install
npm run build
npm start
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `COPILOT_EXT_PORT` | `3001` | Port for the Copilot Extension server |
| `GHAS_API_URL` | `http://localhost:3000` | Main GHAS Express API URL |
| `GHAS_API_TOKEN` | — | Optional auth token for GHAS API |

## GitHub App Configuration

To register as a Copilot Extension, create a GitHub App with:
- **Callback URL:** `http://localhost:3001/`
- **Copilot Agent URL:** `http://localhost:3001/`
- Enable the Copilot Chat extension type
