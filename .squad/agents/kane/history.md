# Kane — History

## Project Context
- Express server: `src/server.ts` (port 3000)
- Demo routes: `src/api/demo-routes.ts` → GitHub client: `src/api/github-client.ts`
- PII routes: `src/pii-demo/pii-routes.ts` → DB: `src/pii-demo/database.ts`
- Redaction: `src/services/redaction-service.ts` (maskSSN, maskEmail, maskPhone, etc.)
- Audit: `src/security/audit-logger.ts`
- Encryption: `src/security/encryption.ts` (AES-256-GCM)
- Demo incidents: `src/demo-incidents/` (vulnerable + remediated files)
- Env vars: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, PORT, ENCRYPTION_KEY
- User: Saurabh

## Learnings
