import jwt from 'jsonwebtoken';
import { Router, type Request, type Response } from 'express';
import {
  authenticate,
  getAllUsers,
  createUser,
  updateUser,
  deactivateUser,
  activateUser,
  resetPassword,
  getRolePermissions,
} from '../services/auth-service';
import { authMiddleware, requireRole } from '../middleware/rbac';
import { ROLES } from '../models/auth-types';
import type { CreateUserInput, Role } from '../models/auth-types';

const router = Router();

/**
 * POST /api/auth/login
 * Body: { email, password }
 */
router.post('/login', (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ success: false, error: 'Email and password are required' });
    return;
  }

  const result = authenticate(email, password);
  if (!result.success) {
    res.status(401).json(result);
    return;
  }

  res.json(result);
});

/**
 * GET /api/auth/me
 * Requires: valid JWT
 */
router.get('/me', authMiddleware, (req: Request, res: Response) => {
  res.json({ success: true, user: req.user });
});

/**
 * POST /api/auth/refresh
 * Requires: valid JWT — issues a new token with a fresh expiry.
 */
router.post('/refresh', authMiddleware, (req: Request, res: Response) => {
  const user = req.user!;
  const secret = process.env.JWT_SECRET ?? 'ghas-demo-jwt-secret-change-in-prod';
  const token = jwt.sign(
    { sub: user.sub, email: user.email, role: user.role, name: user.name },
    secret,
    { expiresIn: '8h' },
  );
  res.json({ success: true, token });
});

/**
 * GET /api/auth/users
 * Requires: system_admin or security_admin role
 */
router.get('/users', authMiddleware, requireRole('system_admin', 'security_admin'), (_req: Request, res: Response) => {
  res.json({ success: true, users: getAllUsers() });
});

/**
 * POST /api/auth/users
 * Create a new user. Requires: system_admin or security_admin role.
 * Body: { name, email, password, role }
 */
router.post('/users', authMiddleware, requireRole('system_admin', 'security_admin'), (req: Request, res: Response) => {
  const { name, email, password, role } = req.body as Partial<CreateUserInput>;

  if (!name || !email || !password || !role) {
    res.status(400).json({ success: false, error: 'name, email, password, and role are required' });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    return;
  }

  if (!ROLES.includes(role as Role)) {
    res.status(400).json({ success: false, error: `Invalid role. Must be one of: ${ROLES.join(', ')}` });
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    res.status(400).json({ success: false, error: 'Invalid email format' });
    return;
  }

  const result = createUser({ name, email, password, role: role as Role });
  if (!result.success) {
    res.status(409).json(result);
    return;
  }

  res.status(201).json({ success: true, user: result.user });
});

/**
 * PUT /api/auth/users/:id
 * Update user role or name. Requires: system_admin role.
 * Body: { name?, role? }
 */
router.put('/users/:id', authMiddleware, requireRole('system_admin'), (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, role } = req.body as { name?: string; role?: Role };

  if (!name && !role) {
    res.status(400).json({ success: false, error: 'At least one of name or role must be provided' });
    return;
  }

  if (role && !ROLES.includes(role as Role)) {
    res.status(400).json({ success: false, error: `Invalid role. Must be one of: ${ROLES.join(', ')}` });
    return;
  }

  const updated = updateUser(id, { name, role });
  if (!updated) {
    res.status(404).json({ success: false, error: 'User not found' });
    return;
  }

  res.json({ success: true, user: updated });
});

/**
 * DELETE /api/auth/users/:id
 * Deactivate user (soft-delete). Requires: system_admin role.
 */
router.delete('/users/:id', authMiddleware, requireRole('system_admin'), (req: Request, res: Response) => {
  const { id } = req.params;

  if (req.user!.sub === id) {
    res.status(400).json({ success: false, error: 'Cannot deactivate your own account' });
    return;
  }

  const success = deactivateUser(id);
  if (!success) {
    res.status(404).json({ success: false, error: 'User not found' });
    return;
  }

  res.json({ success: true, message: 'User deactivated' });
});

/**
 * POST /api/auth/users/:id/activate
 * Re-activate a deactivated user. Requires: system_admin role.
 */
router.post('/users/:id/activate', authMiddleware, requireRole('system_admin'), (req: Request, res: Response) => {
  const { id } = req.params;

  const success = activateUser(id);
  if (!success) {
    res.status(404).json({ success: false, error: 'User not found' });
    return;
  }

  res.json({ success: true, message: 'User activated' });
});

/**
 * POST /api/auth/users/:id/reset-password
 * Reset a user's password. Requires: system_admin role.
 * Body: { newPassword }
 */
router.post('/users/:id/reset-password', authMiddleware, requireRole('system_admin'), (req: Request, res: Response) => {
  const { id } = req.params;
  const { newPassword } = req.body as { newPassword?: string };

  if (!newPassword || newPassword.length < 8) {
    res.status(400).json({ success: false, error: 'newPassword is required and must be at least 8 characters' });
    return;
  }

  const success = resetPassword(id, newPassword);
  if (!success) {
    res.status(404).json({ success: false, error: 'User not found' });
    return;
  }

  res.json({ success: true, message: 'Password reset successfully' });
});

/**
 * GET /api/auth/roles
 * List all roles with their permissions. Public info for the admin UI.
 */
router.get('/roles', (_req: Request, res: Response) => {
  const permissions = getRolePermissions();
  const roles = ROLES.map((role) => ({
    role,
    permissions: [...permissions[role]],
  }));
  res.json({ success: true, roles });
});

export default router;
