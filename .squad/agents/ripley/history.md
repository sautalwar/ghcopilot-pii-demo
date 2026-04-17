# Ripley — History

## Project Context
- TypeScript/Express server at `src/server.ts`
- Two route groups: Demo orchestration (`/api/demos`) and PII runtime proof (`/api/pii-demo`)
- GitHub interaction via `src/api/github-client.ts` (Octokit, returns `GitHubResult<T>`)
- Demo scenarios in `src/api/demo-definitions.ts`
- PII redaction in `src/services/redaction-service.ts`
- Frontend: `public/index.html` (single-file static presenter)
- User: Saurabh

## Learnings
