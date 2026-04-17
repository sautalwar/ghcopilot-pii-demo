import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PolicyException {
  type: 'repo' | 'directory' | 'file' | 'rule';
  path?: string;
  name?: string;
  id?: string;
  scope?: string;
  reason: string;
  approved_by: string;
  permanent?: boolean;
  expires?: string;
  jira_ticket?: string;
}

export interface ExceptionStatus {
  exception: PolicyException;
  isActive: boolean;
  isExpired: boolean;
  isExpiringSoon: boolean;
  daysUntilExpiry: number | null;
}

export interface ExceptionCheckResult {
  isExcepted: boolean;
  matchedExceptions: PolicyException[];
}

export interface ExceptionAuditEntry {
  timestamp: string;
  filePath: string;
  ruleId?: string;
  wasExcepted: boolean;
  matchedException?: PolicyException;
}

interface GhasPolicyRaw {
  version?: string;
  exceptions?: {
    directories?: Array<{
      path: string;
      reason: string;
      approved_by: string;
      permanent?: boolean;
      expires?: string;
      jira_ticket?: string;
    }>;
    files?: Array<{
      path: string;
      reason: string;
      approved_by: string;
      permanent?: boolean;
      expires?: string;
      jira_ticket?: string;
    }>;
    rules?: Array<{
      id: string;
      scope: string;
      reason: string;
      approved_by: string;
      permanent?: boolean;
      expires?: string;
      jira_ticket?: string;
    }>;
  };
  expiration_policy?: {
    warn_days_before?: number;
    action_on_expire?: string;
    notify?: string[];
  };
}

export interface GhasPolicy {
  version: string;
  exceptions: PolicyException[];
  expirationPolicy: {
    warnDaysBefore: number;
    actionOnExpire: string;
    notify: string[];
  };
}

// ── Policy cache ───────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000;
let cachedPolicy: GhasPolicy | null = null;
let cachedPolicyPath: string | null = null;
let cacheTimestamp = 0;

// ── Glob matching ──────────────────────────────────────────────────────────────

function toForwardSlash(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Simple glob matcher supporting `**` (any path segments) and `*` (single segment).
 * Both pattern and candidate are compared using forward slashes.
 */
function globMatch(pattern: string, candidate: string): boolean {
  const p = toForwardSlash(pattern);
  const c = toForwardSlash(candidate);

  const regexStr = p
    .split('/')
    .map((segment) => {
      if (segment === '**') return '.*';
      // Escape regex-special chars except *, then convert * to [^/]*
      const escaped = segment.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      return escaped.replace(/\*/g, '[^/]*');
    })
    .join('/');

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(c);
}

// ── Core functions ─────────────────────────────────────────────────────────────

export function loadPolicy(repoRoot?: string): GhasPolicy {
  const root = repoRoot ?? process.cwd();
  const policyPath = path.join(root, '.ghas-policy.yml');

  // Return cached policy if still fresh and same path
  const now = Date.now();
  if (cachedPolicy && cachedPolicyPath === policyPath && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedPolicy;
  }

  if (!fs.existsSync(policyPath)) {
    const empty: GhasPolicy = {
      version: '1.0',
      exceptions: [],
      expirationPolicy: { warnDaysBefore: 30, actionOnExpire: 'reactivate', notify: [] },
    };
    cachedPolicy = empty;
    cachedPolicyPath = policyPath;
    cacheTimestamp = now;
    return empty;
  }

  const raw = yaml.load(fs.readFileSync(policyPath, 'utf8')) as GhasPolicyRaw;
  const exceptions: PolicyException[] = [];

  if (raw.exceptions?.directories) {
    for (const d of raw.exceptions.directories) {
      exceptions.push({
        type: 'directory',
        path: d.path,
        reason: d.reason,
        approved_by: d.approved_by,
        permanent: d.permanent,
        expires: d.expires,
        jira_ticket: d.jira_ticket,
      });
    }
  }

  if (raw.exceptions?.files) {
    for (const f of raw.exceptions.files) {
      exceptions.push({
        type: 'file',
        path: f.path,
        reason: f.reason,
        approved_by: f.approved_by,
        permanent: f.permanent,
        expires: f.expires,
        jira_ticket: f.jira_ticket,
      });
    }
  }

  if (raw.exceptions?.rules) {
    for (const r of raw.exceptions.rules) {
      exceptions.push({
        type: 'rule',
        id: r.id,
        scope: r.scope,
        reason: r.reason,
        approved_by: r.approved_by,
        permanent: r.permanent,
        expires: r.expires,
        jira_ticket: r.jira_ticket,
      });
    }
  }

  const ep = raw.expiration_policy;
  const policy: GhasPolicy = {
    version: raw.version ?? '1.0',
    exceptions,
    expirationPolicy: {
      warnDaysBefore: ep?.warn_days_before ?? 30,
      actionOnExpire: ep?.action_on_expire ?? 'reactivate',
      notify: ep?.notify ?? [],
    },
  };

  cachedPolicy = policy;
  cachedPolicyPath = policyPath;
  cacheTimestamp = now;
  return policy;
}

// ── Expiry helpers ─────────────────────────────────────────────────────────────

function computeExpiryStatus(ex: PolicyException, warnDays: number): ExceptionStatus {
  if (ex.permanent) {
    return { exception: ex, isActive: true, isExpired: false, isExpiringSoon: false, daysUntilExpiry: null };
  }

  if (!ex.expires) {
    // No expiry and not permanent — treat as expired (invalid state)
    return { exception: ex, isActive: false, isExpired: true, isExpiringSoon: false, daysUntilExpiry: null };
  }

  const expiryDate = new Date(ex.expires);
  const now = new Date();
  const msPerDay = 86_400_000;
  const diff = expiryDate.getTime() - now.getTime();
  const daysUntil = Math.ceil(diff / msPerDay);

  return {
    exception: ex,
    isActive: daysUntil >= 0,
    isExpired: daysUntil < 0,
    isExpiringSoon: daysUntil >= 0 && daysUntil <= warnDays,
    daysUntilExpiry: daysUntil,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function isExcepted(filePath: string, ruleId?: string, repoRoot?: string): ExceptionCheckResult {
  const policy = loadPolicy(repoRoot);
  const normalised = toForwardSlash(path.normalize(filePath));
  const matched: PolicyException[] = [];

  for (const ex of policy.exceptions) {
    const status = computeExpiryStatus(ex, policy.expirationPolicy.warnDaysBefore);
    if (!status.isActive) continue;

    switch (ex.type) {
      case 'directory':
        if (ex.path && globMatch(ex.path, normalised)) {
          matched.push(ex);
        }
        break;

      case 'file':
        if (ex.path && toForwardSlash(ex.path) === normalised) {
          matched.push(ex);
        }
        break;

      case 'rule':
        if (ruleId && ex.id === ruleId && ex.scope && globMatch(ex.scope, normalised)) {
          matched.push(ex);
        }
        break;
    }
  }

  return { isExcepted: matched.length > 0, matchedExceptions: matched };
}

export function getActiveExceptions(repoRoot?: string): ExceptionStatus[] {
  const policy = loadPolicy(repoRoot);
  return policy.exceptions
    .map((ex) => computeExpiryStatus(ex, policy.expirationPolicy.warnDaysBefore))
    .filter((s) => s.isActive);
}

export function getExpiringSoon(days?: number, repoRoot?: string): ExceptionStatus[] {
  const policy = loadPolicy(repoRoot);
  const warnDays = days ?? policy.expirationPolicy.warnDaysBefore;

  return policy.exceptions
    .map((ex) => computeExpiryStatus(ex, warnDays))
    .filter((s) => s.isExpiringSoon);
}

export function validateException(exception: PolicyException): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!exception.reason || exception.reason.trim().length === 0) {
    errors.push('reason is required and must be non-empty');
  }
  if (!exception.approved_by || exception.approved_by.trim().length === 0) {
    errors.push('approved_by is required and must be non-empty');
  }
  if (!exception.permanent && !exception.expires) {
    errors.push('exception must have either permanent: true or an expires date');
  }
  if (exception.expires) {
    const d = new Date(exception.expires);
    if (isNaN(d.getTime())) {
      errors.push('expires must be a valid ISO date string');
    }
  }

  return { valid: errors.length === 0, errors };
}

export function auditExceptionUsage(
  findings: Array<{ filePath: string; ruleId?: string }>,
  repoRoot?: string,
): ExceptionAuditEntry[] {
  const timestamp = new Date().toISOString();

  return findings.map((f) => {
    const result = isExcepted(f.filePath, f.ruleId, repoRoot);
    const entry: ExceptionAuditEntry = {
      timestamp,
      filePath: f.filePath,
      ruleId: f.ruleId,
      wasExcepted: result.isExcepted,
    };
    if (result.matchedExceptions.length > 0) {
      entry.matchedException = result.matchedExceptions[0];
    }
    return entry;
  });
}
