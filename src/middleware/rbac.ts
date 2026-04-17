import type { NextFunction, Request, Response } from 'express';
import type { Permission, Role, RolePermissionMap, UserPayload } from '../models/auth-types';
import { verifyToken } from '../services/auth-service';

/* ------------------------------------------------------------------ */
/*  Extend Express Request to carry authenticated user                */
/* ------------------------------------------------------------------ */
declare global {
  namespace Express {
    interface Request {
      user?: UserPayload;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Role → Permission matrix                                          */
/* ------------------------------------------------------------------ */
export const ROLE_PERMISSIONS: RolePermissionMap = {
  security_admin: ['*'],
  security_analyst: [
    'cve:read', 'cve:create-ticket', 'zero-day:read', 'trends:read',
    'jira:read', 'jira:create', 'governance:read', 'pipeline:read',
  ],
  developer: ['cve:read', 'trends:read', 'jira:read', 'governance:read'],
  team_lead: [
    'cve:read', 'trends:read', 'jira:read', 'jira:create',
    'governance:read', 'governance:approve', 'pipeline:read',
  ],
  compliance_officer: [
    'governance:read', 'governance:audit', 'license:read', 'sbom:read', 'trends:read',
  ],
  demo_operator: [
    'demo:run', 'cve:read', 'jira:read', 'trends:read', 'zero-day:read', 'governance:read',
  ],
  viewer: ['*:read'],
  system_admin: ['auth:manage', 'users:manage', 'config:manage'],
} as const;

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function hasPermission(role: Role, required: string): boolean {
  const perms: readonly Permission[] = ROLE_PERMISSIONS[role];

  // Wildcard — full access
  if ((perms as readonly string[]).includes('*')) return true;

  // Read-wildcard — matches any `:read` permission
  if ((perms as readonly string[]).includes('*:read') && required.endsWith(':read')) return true;

  return (perms as readonly string[]).includes(required as Permission);
}

function sendUnauthorized(res: Response, msg = 'Authentication required') {
  res.status(401).json({ success: false, error: msg });
}

function sendForbidden(res: Response, msg = 'Insufficient permissions') {
  res.status(403).json({ success: false, error: msg });
}

/* ------------------------------------------------------------------ */
/*  Middleware                                                         */
/* ------------------------------------------------------------------ */

/** Extract and verify Bearer token, attach `req.user`. Rejects if no valid token. */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    sendUnauthorized(res);
    return;
  }

  const token = header.slice(7);
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    sendUnauthorized(res, 'Invalid or expired token');
  }
}

// TODO: Make auth required in production
/** Soft auth — sets `req.user` when a valid token is present, otherwise proceeds anonymously. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      req.user = verifyToken(header.slice(7));
    } catch {
      // Token invalid — proceed as anonymous
    }
  }
  next();
}

/** Restrict access to one or more roles. */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendUnauthorized(res);
      return;
    }
    if (!roles.includes(req.user.role)) {
      sendForbidden(res, `Role '${req.user.role}' is not authorized for this resource`);
      return;
    }
    next();
  };
}

/** Restrict access by permission string. */
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendUnauthorized(res);
      return;
    }
    if (!hasPermission(req.user.role, permission)) {
      sendForbidden(res, `Missing permission: ${permission}`);
      return;
    }
    next();
  };
}
