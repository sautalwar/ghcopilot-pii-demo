import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import path from 'node:path';
import type { AuthResult, CreateUserInput, Permission, Role, SafeUser, User, UserPayload } from '../models/auth-types';
import { ROLES } from '../models/auth-types';
import { ROLE_PERMISSIONS } from '../middleware/rbac';

const JWT_SECRET = process.env.JWT_SECRET ?? 'ghas-demo-jwt-secret-change-in-prod';
const TOKEN_EXPIRY = '8h';
const BCRYPT_ROUNDS = 10;

interface SeedUser {
  id: string;
  name: string;
  email: string;
  password: string;
  role: Role;
}

/** In-memory user store, hydrated from seed data on first access */
let users: User[] | null = null;

function loadUsers(): User[] {
  if (users) return users;

  const seedPath = path.resolve(process.cwd(), 'data', 'seed-users.json');
  const raw: SeedUser[] = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));

  users = raw.map((s) => ({
    id: s.id,
    name: s.name,
    email: s.email.toLowerCase(),
    passwordHash: bcrypt.hashSync(s.password, BCRYPT_ROUNDS),
    role: s.role,
    active: true,
    createdAt: new Date().toISOString(),
  }));

  return users;
}

function toSafeUser(u: User): SafeUser {
  return { id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, createdAt: u.createdAt };
}

/** Authenticate by email + password, returning a signed JWT on success. */
export function authenticate(email: string, password: string): AuthResult {
  const store = loadUsers();
  const user = store.find((u) => u.email === email.toLowerCase());

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return { success: false, error: 'Invalid email or password' };
  }

  if (!user.active) {
    return { success: false, error: 'Account is deactivated. Contact an administrator.' };
  }

  const payload: Omit<UserPayload, 'iat' | 'exp'> = {
    sub: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });

  return { success: true, token, user: toSafeUser(user) };
}

/** Verify a JWT and return the decoded payload. Throws on invalid/expired token. */
export function verifyToken(token: string): UserPayload {
  return jwt.verify(token, JWT_SECRET) as UserPayload;
}

/** Hash a plaintext password with bcrypt. */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/** Return all users with passwords stripped. */
export function getAllUsers(): SafeUser[] {
  return loadUsers().map(toSafeUser);
}

/** Create a new user. Validates email uniqueness. */
export function createUser(input: CreateUserInput): AuthResult {
  const store = loadUsers();

  if (store.find((u) => u.email === input.email.toLowerCase())) {
    return { success: false, error: 'A user with this email already exists' };
  }

  if (!ROLES.includes(input.role)) {
    return { success: false, error: `Invalid role: ${input.role}` };
  }

  const newUser: User = {
    id: `usr_${String(store.length + 1).padStart(3, '0')}`,
    name: input.name,
    email: input.email.toLowerCase(),
    passwordHash: bcrypt.hashSync(input.password, BCRYPT_ROUNDS),
    role: input.role,
    active: true,
    createdAt: new Date().toISOString(),
  };

  store.push(newUser);

  return { success: true, token: '', user: toSafeUser(newUser) };
}

/** Update user name and/or role. Returns updated safe user or null if not found. */
export function updateUser(id: string, updates: { name?: string; role?: Role }): SafeUser | null {
  const store = loadUsers();
  const user = store.find((u) => u.id === id);
  if (!user) return null;

  if (updates.name !== undefined) user.name = updates.name;
  if (updates.role !== undefined) {
    if (!ROLES.includes(updates.role)) return null;
    user.role = updates.role;
  }

  return toSafeUser(user);
}

/** Deactivate a user (soft-delete). Returns false if user not found. */
export function deactivateUser(id: string): boolean {
  const store = loadUsers();
  const user = store.find((u) => u.id === id);
  if (!user) return false;
  user.active = false;
  return true;
}

/** Activate a previously deactivated user. Returns false if user not found. */
export function activateUser(id: string): boolean {
  const store = loadUsers();
  const user = store.find((u) => u.id === id);
  if (!user) return false;
  user.active = true;
  return true;
}

/** Reset a user's password. Returns false if user not found. */
export function resetPassword(id: string, newPassword: string): boolean {
  const store = loadUsers();
  const user = store.find((u) => u.id === id);
  if (!user) return false;
  user.passwordHash = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS);
  return true;
}

/** Return the full role→permission map. */
export function getRolePermissions(): Record<Role, readonly Permission[]> {
  return { ...ROLE_PERMISSIONS };
}
