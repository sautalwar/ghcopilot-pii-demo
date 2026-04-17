# Hicks — History

## Onboarding
- **Project:** ghcopilot-pii-demo — Live demo orchestration platform for GitHub Advanced Security
- **Stack:** TypeScript, Express 4.18.2, SQLite (better-sqlite3), Octokit v21, single-file HTML frontend
- **User:** Saurabh
- **Joined:** 2026-04-17
- **Context:** Platform has 10+ backend services (CVE feed, zero-day intel, Jira bridge, governance, license compliance, vulnerability trends, risk exceptions), 5+ API route groups, 10 frontend dashboard tabs, MCP server with 16 tools. Saurabh wants RBAC to gate access by role across all these surfaces.

## Learnings

- **2025-07-17 — RBAC Auth Layer Build**: Created the full RBAC auth layer (5 files). Key decisions:
  - Used `bcryptjs` (pure JS) over `bcrypt` to avoid native compilation issues across platforms.
  - HS256 with env-var `JWT_SECRET` (defaulting to a demo secret) chosen over RS256 — simpler for a demo platform.
  - Seed users are hashed at first load and kept in memory — no database dependency for auth.
  - Token expiry set to 8h for demo-friendly sessions.
  - The `viewer` role uses a `*:read` wildcard pattern; `security_admin` has `*` wildcard.
  - Express `Request.user` extended via declaration merging in `src/middleware/rbac.ts`.

- **2025-07-17 — Route Guards Wired**: Mounted auth routes at `/api/auth` and applied RBAC guards to all 7 existing route groups. Key decisions:
  - Created `optionalAuth` middleware that sets `req.user` when a valid token is present but never blocks — backward-compatible for unauthenticated demo usage. Marked `TODO: Make auth required in production`.
  - `authMiddleware` (strict) reserved for `/api/auth/me`, `/api/auth/refresh`, `/api/auth/users` only.
  - Router-level `optionalAuth` applied to every route group; per-route `requireRole`/`requirePermission` guards layered on top.
  - Demo routes and PII routes use role-based gating (`requireRole`); data-read routes use permission-based gating (`requirePermission`).
  - POST write operations (seed, bridge, approve) require elevated permissions vs GET reads.
  - All changes compile cleanly with `npx tsc --noEmit`.

- **2025-07-17 — Admin Panel Build**: Built full user management admin panel (Tab 10). Key decisions:
  - Added `active: boolean` field to `User` and `SafeUser` interfaces — deactivation is a soft-delete, not a hard delete.
  - `createUser()` generates sequential IDs (`usr_NNN`) from the store length — acceptable for an in-memory demo store.
  - `GET /api/auth/users` broadened from `system_admin`-only to include `security_admin` — both need user visibility.
  - `POST /api/auth/users` (create) allows both `system_admin` and `security_admin`; `PUT`/`DELETE`/reset-password restricted to `system_admin` only per spec.
  - Added `POST /api/auth/users/:id/activate` endpoint (not in original spec) to complement deactivation — needed for the toggle UX.
  - `GET /api/auth/roles` is unauthenticated — role/permission info is non-sensitive and needed by the admin UI before heavy auth flows.
  - Deactivated users are blocked at login (`authenticate()` returns error if `!user.active`).
  - Frontend role matrix resolves `*` and `*:read` wildcards client-side to show full checkmark grid.
  - All admin API calls include auth headers via existing `getAuthHeaders()` helper.
  - `auth-service.ts` now imports `ROLE_PERMISSIONS` from `rbac.ts` and `ROLES` from `auth-types.ts` to avoid duplication.

## Wave 4 Completion (2026-04-17)
- **Status:** ✅ All assigned tasks complete. Admin panel fully functional.
- **Verification:** TypeScript compiles cleanly. Server tested on port 3000.
- **Session artifacts:** .squad/orchestration-log/2026-04-17T0756-wave1-wave4.md.
