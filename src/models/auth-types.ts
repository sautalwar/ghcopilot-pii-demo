/**
 * RBAC type definitions for the GHAS demo platform.
 */

export const ROLES = [
  'security_admin',
  'security_analyst',
  'developer',
  'team_lead',
  'compliance_officer',
  'demo_operator',
  'viewer',
  'system_admin',
] as const;

export type Role = typeof ROLES[number];

export type Permission =
  | '*'
  | '*:read'
  | 'cve:read'
  | 'cve:create-ticket'
  | 'zero-day:read'
  | 'trends:read'
  | 'jira:read'
  | 'jira:create'
  | 'governance:read'
  | 'governance:approve'
  | 'governance:audit'
  | 'pipeline:read'
  | 'license:read'
  | 'sbom:read'
  | 'demo:run'
  | 'auth:manage'
  | 'users:manage'
  | 'config:manage';

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

/** Safe user object — no password hash */
export interface SafeUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

/** Input for creating a new user */
export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: Role;
}

/** JWT decoded payload */
export interface UserPayload {
  sub: string;
  email: string;
  role: Role;
  name: string;
  iat: number;
  exp: number;
}

export type RolePermissionMap = Record<Role, readonly Permission[]>;

export type AuthResult =
  | { success: true; token: string; user: SafeUser }
  | { success: false; error: string };
