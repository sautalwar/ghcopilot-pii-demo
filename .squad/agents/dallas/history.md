# Dallas — History

## Project Context
- Main UI: `public/index.html` (single-file static presenter console)
- Interactive demo: `public/interactive-demo.html`
- Calls `/api/demos/*` via fetch for demo orchestration
- No framework — vanilla HTML/CSS/JS
- User: Saurabh

## Learnings

### RBAC Frontend (Login Modal + Role-Based Tabs)
- Added ~440 lines to `public/index.html`: login modal CSS, HTML overlay, auth JS, role-tab mapping, 401 handling
- `ROLE_TAB_ACCESS` maps 8 roles to allowed tab indices (0-9); `renderNavigation()` filters `NAV_TABS` through this
- JWT stored in `sessionStorage` (not localStorage) per spec — cleared on tab close
- All `fetch()` calls updated to include `getAuthHeaders()` which adds `Authorization: Bearer <token>`
- `apiRequest()` (the demo orchestration fetch wrapper) also calls `handleUnauthorized()` for 401 auto-logout
- Demo accounts list is clickable — auto-fills email/password for quick demo logins
- User badge with avatar initials, name, role, and logout button appears in hero-actions area
- `hideRestrictedTabPanels()` sets `display:none` on unauthorized tab panels; `switchTab()` unchanged

## Wave 3 Completion (2026-04-17)
- **Status:** ✅ Frontend login modal and role-based tab gating complete.
- **Verification:** Login tested. Role-based visibility working. Auto-logout on 401.
- **Session artifacts:** .squad/orchestration-log/2026-04-17T0756-wave1-wave4.md.
