import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

// ── Types ──────────────────────────────────────────────────────────────────

export type LicenseStatus = 'allowed' | 'denied' | 'review_required' | 'unknown' | 'override_approved';

export interface LicenseInfo {
  packageName: string;
  version: string;
  license: string | null;
  normalizedLicense: string | null;
  status: LicenseStatus;
  isDirect: boolean;
  reason?: string;
}

export interface LicenseReport {
  timestamp: string;
  totalPackages: number;
  allowed: number;
  denied: number;
  reviewRequired: number;
  unknown: number;
  overrideApproved: number;
  packages: LicenseInfo[];
  violations: LicenseInfo[];
  compliant: boolean;
}

export interface SBOMPackage {
  name: string;
  version: string;
  license: string;
  supplier?: string;
  downloadUrl?: string;
}

export interface SPDXSBOM {
  spdxVersion: string;
  dataLicense: string;
  SPDXID: string;
  name: string;
  documentNamespace: string;
  creationInfo: {
    created: string;
    creators: string[];
  };
  packages: Array<{
    SPDXID: string;
    name: string;
    versionInfo: string;
    licenseConcluded: string;
    licenseDeclared: string;
    downloadLocation: string;
    copyrightText: string;
  }>;
}

// ── Internal types ─────────────────────────────────────────────────────────

interface LicensePolicy {
  allowed: string[];
  denied: string[];
  review_required: string[];
  unknown_license_action: string;
  check_transitive: boolean;
  overrides: Array<{ package: string; version?: string; approved: boolean; reason?: string }>;
}

interface LockfileEntry {
  version?: string;
  resolved?: string;
  license?: string;
  dev?: boolean;
  dependencies?: Record<string, string>;
}

// ── License alias map ──────────────────────────────────────────────────────

const LICENSE_ALIASES: Record<string, string> = {
  'apache 2.0': 'Apache-2.0',
  'apache 2': 'Apache-2.0',
  'apache-2': 'Apache-2.0',
  'apache2': 'Apache-2.0',
  'apache license 2.0': 'Apache-2.0',
  'apache license, version 2.0': 'Apache-2.0',
  'bsd': 'BSD-2-Clause',
  'bsd-2': 'BSD-2-Clause',
  'bsd-3': 'BSD-3-Clause',
  'bsd 2-clause': 'BSD-2-Clause',
  'bsd 3-clause': 'BSD-3-Clause',
  'mit/x11': 'MIT',
  'mit license': 'MIT',
  'isc license': 'ISC',
  'the mit license': 'MIT',
  'gpl-2.0-only': 'GPL-2.0',
  'gpl-3.0-only': 'GPL-3.0',
  'gpl-2.0-or-later': 'GPL-2.0',
  'gpl-3.0-or-later': 'GPL-3.0',
  'agpl-3.0-only': 'AGPL-3.0',
  'agpl-3.0-or-later': 'AGPL-3.0',
  'lgpl-2.1-only': 'LGPL-2.1',
  'lgpl-2.1-or-later': 'LGPL-2.1',
  'lgpl-3.0-only': 'LGPL-3.0',
  'lgpl-3.0-or-later': 'LGPL-3.0',
  'mpl 2.0': 'MPL-2.0',
  'artistic-2.0': 'Artistic-2.0',
  'cc0 1.0': 'CC0-1.0',
  'cc0-1.0 universal': 'CC0-1.0',
  'public domain': 'Unlicense',
  'unlicensed': 'Unlicense',
  'wtfpl': 'WTFPL',
  'python-2.0': 'Python-2.0',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function loadPolicy(repoRoot: string): LicensePolicy {
  const govPath = path.join(repoRoot, '.ghas-governance.yml');
  if (!fs.existsSync(govPath)) {
    return {
      allowed: [],
      denied: [],
      review_required: [],
      unknown_license_action: 'fail',
      check_transitive: true,
      overrides: [],
    };
  }

  const content = fs.readFileSync(govPath, 'utf-8');
  const doc = yaml.load(content) as Record<string, unknown>;
  const lc = (doc?.license_compliance ?? {}) as Partial<LicensePolicy>;

  return {
    allowed: Array.isArray(lc.allowed) ? lc.allowed : [],
    denied: Array.isArray(lc.denied) ? lc.denied : [],
    review_required: Array.isArray(lc.review_required) ? lc.review_required : [],
    unknown_license_action: typeof lc.unknown_license_action === 'string' ? lc.unknown_license_action : 'fail',
    check_transitive: lc.check_transitive !== false,
    overrides: Array.isArray(lc.overrides) ? lc.overrides : [],
  };
}

function normalizeLicense(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // "SEE LICENSE IN …" patterns → unknown
  if (/^see license/i.test(trimmed)) return null;
  if (/^https?:\/\//i.test(trimmed)) return null;

  // Check alias map (case-insensitive)
  const lower = trimmed.toLowerCase();
  if (LICENSE_ALIASES[lower]) return LICENSE_ALIASES[lower];

  // Already looks like a valid SPDX identifier — return as-is
  return trimmed;
}

/**
 * Parse SPDX expressions like "(MIT OR Apache-2.0)" into constituent license IDs.
 * Returns an array of individual IDs.
 */
function parseSpdxExpression(expr: string): string[] {
  // Strip outer parens
  let cleaned = expr.replace(/^\(+/, '').replace(/\)+$/, '');
  // Split on OR / AND (SPDX operators)
  const parts = cleaned.split(/\s+(?:OR|AND|WITH)\s+/i);
  return parts.map(p => p.trim()).filter(Boolean);
}

function extractLicenseFromPackageJson(pkgJson: Record<string, unknown>): string | null {
  // "license": "MIT"
  if (typeof pkgJson.license === 'string') {
    return pkgJson.license;
  }
  // "license": { "type": "MIT", "url": "..." }
  if (pkgJson.license && typeof pkgJson.license === 'object') {
    const licObj = pkgJson.license as Record<string, unknown>;
    if (typeof licObj.type === 'string') return licObj.type;
  }
  // "licenses": [{ "type": "MIT" }]
  if (Array.isArray(pkgJson.licenses) && pkgJson.licenses.length > 0) {
    const first = pkgJson.licenses[0] as Record<string, unknown>;
    if (typeof first?.type === 'string') return first.type;
    // Array of strings
    if (typeof pkgJson.licenses[0] === 'string') return pkgJson.licenses[0] as string;
  }
  return null;
}

function classifyLicense(normalized: string | null, policy: LicensePolicy): { status: LicenseStatus; reason: string } {
  if (!normalized) {
    const action = policy.unknown_license_action === 'fail' ? 'unknown' : 'unknown';
    return { status: 'unknown', reason: 'License could not be determined' };
  }

  // Handle SPDX expressions — if any alternative is allowed, consider it allowed
  const parts = parseSpdxExpression(normalized);
  if (parts.length > 1) {
    // Check if any part is denied first
    const deniedParts = parts.filter(p => policy.denied.includes(p));
    const allowedParts = parts.filter(p => policy.allowed.includes(p));

    // OR expression: at least one allowed alternative means it's okay
    if (allowedParts.length > 0) {
      return { status: 'allowed', reason: `${allowedParts[0]} is in allowed list (from expression: ${normalized})` };
    }
    if (deniedParts.length > 0) {
      return { status: 'denied', reason: `${deniedParts[0]} is in denied list (from expression: ${normalized})` };
    }
    const reviewParts = parts.filter(p => policy.review_required.includes(p));
    if (reviewParts.length > 0) {
      return { status: 'review_required', reason: `${reviewParts[0]} requires review (from expression: ${normalized})` };
    }
    return { status: 'unknown', reason: `None of the licenses in expression "${normalized}" are recognized` };
  }

  // Single license
  const id = parts[0] || normalized;
  if (policy.allowed.includes(id)) {
    return { status: 'allowed', reason: `${id} is in allowed list` };
  }
  if (policy.denied.includes(id)) {
    return { status: 'denied', reason: `${id} is in denied list` };
  }
  if (policy.review_required.includes(id)) {
    return { status: 'review_required', reason: `${id} requires manual review` };
  }
  return { status: 'unknown', reason: `${id} is not in any policy list` };
}

interface ParsedPackage {
  name: string;
  version: string;
  license: string | null;
  isDirect: boolean;
}

function loadPackages(repoRoot: string): ParsedPackage[] {
  const lockfilePath = path.join(repoRoot, 'package-lock.json');
  if (!fs.existsSync(lockfilePath)) return [];

  let lockfile: Record<string, unknown>;
  try {
    lockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf-8'));
  } catch {
    return [];
  }

  const rootPkgPath = path.join(repoRoot, 'package.json');
  let directDeps: Set<string> = new Set();
  if (fs.existsSync(rootPkgPath)) {
    try {
      const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
      const deps = rootPkg.dependencies ?? {};
      const devDeps = rootPkg.devDependencies ?? {};
      directDeps = new Set([...Object.keys(deps), ...Object.keys(devDeps)]);
    } catch {
      // ignore
    }
  }

  const results: ParsedPackage[] = [];

  // lockfile v2/v3: "packages" keyed by path like "node_modules/express"
  const packages = lockfile.packages as Record<string, LockfileEntry> | undefined;
  if (packages && typeof packages === 'object') {
    for (const [pkgPath, entry] of Object.entries(packages)) {
      // Skip root package entry (empty key)
      if (pkgPath === '') continue;
      if (!entry || typeof entry !== 'object') continue;

      // Extract package name from path: "node_modules/@scope/name" → "@scope/name"
      const match = pkgPath.match(/node_modules\/(.+)$/);
      if (!match) continue;

      const name = match[1];
      const version = entry.version ?? 'unknown';

      // Try license from lockfile entry first
      let rawLicense: string | null = typeof entry.license === 'string' ? entry.license : null;

      // Fallback: read package.json from node_modules
      if (!rawLicense) {
        const modulePkgPath = path.join(repoRoot, pkgPath, 'package.json');
        if (fs.existsSync(modulePkgPath)) {
          try {
            const modulePkg = JSON.parse(fs.readFileSync(modulePkgPath, 'utf-8'));
            rawLicense = extractLicenseFromPackageJson(modulePkg);
          } catch {
            // ignore
          }
        }
      }

      results.push({
        name,
        version,
        license: rawLicense,
        isDirect: directDeps.has(name),
      });
    }
    return results;
  }

  // lockfile v1: "dependencies" keyed by package name
  const dependencies = lockfile.dependencies as Record<string, LockfileEntry> | undefined;
  if (dependencies && typeof dependencies === 'object') {
    for (const [name, entry] of Object.entries(dependencies)) {
      if (!entry || typeof entry !== 'object') continue;

      const version = entry.version ?? 'unknown';
      let rawLicense: string | null = null;

      const modulePkgPath = path.join(repoRoot, 'node_modules', name, 'package.json');
      if (fs.existsSync(modulePkgPath)) {
        try {
          const modulePkg = JSON.parse(fs.readFileSync(modulePkgPath, 'utf-8'));
          rawLicense = extractLicenseFromPackageJson(modulePkg);
        } catch {
          // ignore
        }
      }

      results.push({
        name,
        version,
        license: rawLicense,
        isDirect: directDeps.has(name),
      });
    }
  }

  return results;
}

function buildLicenseInfo(pkg: ParsedPackage, policy: LicensePolicy): LicenseInfo {
  const normalized = normalizeLicense(pkg.license);
  let { status, reason } = classifyLicense(normalized, policy);

  // Check overrides
  for (const override of policy.overrides) {
    const nameMatches = override.package === pkg.name;
    const versionMatches = !override.version || override.version === pkg.version;
    if (nameMatches && versionMatches && override.approved) {
      status = 'override_approved';
      reason = override.reason ?? `Override approved for ${pkg.name}`;
      break;
    }
  }

  return {
    packageName: pkg.name,
    version: pkg.version,
    license: pkg.license,
    normalizedLicense: normalized,
    status,
    isDirect: pkg.isDirect,
    reason,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

export function auditLicenses(repoRoot?: string): LicenseReport {
  const root = repoRoot ?? process.cwd();
  const policy = loadPolicy(root);
  const packages = loadPackages(root);
  const infos = packages.map(pkg => buildLicenseInfo(pkg, policy));

  const violations = infos.filter(info => {
    if (info.status === 'denied') return true;
    if (info.status === 'unknown' && policy.unknown_license_action === 'fail') return true;
    return false;
  });

  return {
    timestamp: new Date().toISOString(),
    totalPackages: infos.length,
    allowed: infos.filter(i => i.status === 'allowed').length,
    denied: infos.filter(i => i.status === 'denied').length,
    reviewRequired: infos.filter(i => i.status === 'review_required').length,
    unknown: infos.filter(i => i.status === 'unknown').length,
    overrideApproved: infos.filter(i => i.status === 'override_approved').length,
    packages: infos,
    violations,
    compliant: violations.length === 0,
  };
}

export function checkCompliance(packageName: string, version: string, repoRoot?: string): LicenseInfo {
  const root = repoRoot ?? process.cwd();
  const policy = loadPolicy(root);

  let rawLicense: string | null = null;
  const modulePkgPath = path.join(root, 'node_modules', packageName, 'package.json');
  if (fs.existsSync(modulePkgPath)) {
    try {
      const modulePkg = JSON.parse(fs.readFileSync(modulePkgPath, 'utf-8'));
      rawLicense = extractLicenseFromPackageJson(modulePkg);
    } catch {
      // ignore
    }
  }

  return buildLicenseInfo(
    { name: packageName, version, license: rawLicense, isDirect: true },
    policy,
  );
}

export function getViolations(repoRoot?: string): LicenseInfo[] {
  return auditLicenses(repoRoot).violations;
}

export function getReviewRequired(repoRoot?: string): LicenseInfo[] {
  return auditLicenses(repoRoot).packages.filter(p => p.status === 'review_required');
}

export function getLicenseReport(repoRoot?: string): LicenseReport {
  return auditLicenses(repoRoot);
}

export function generateSBOM(repoRoot?: string): SPDXSBOM {
  const root = repoRoot ?? process.cwd();
  const packages = loadPackages(root);

  let repoName = 'unknown-project';
  const rootPkgPath = path.join(root, 'package.json');
  if (fs.existsSync(rootPkgPath)) {
    try {
      const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
      if (typeof rootPkg.name === 'string') repoName = rootPkg.name;
    } catch {
      // ignore
    }
  }

  const spdxPackages = packages.map((pkg, idx) => {
    const normalized = normalizeLicense(pkg.license);
    const spdxLicense = normalized ?? 'NOASSERTION';

    return {
      SPDXID: `SPDXRef-Package-${idx + 1}`,
      name: pkg.name,
      versionInfo: pkg.version,
      licenseConcluded: spdxLicense,
      licenseDeclared: spdxLicense,
      downloadLocation: `https://www.npmjs.com/package/${pkg.name}`,
      copyrightText: 'NOASSERTION',
    };
  });

  return {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: repoName,
    documentNamespace: `https://spdx.org/spdxdocs/${repoName}-${new Date().toISOString().slice(0, 10)}`,
    creationInfo: {
      created: new Date().toISOString(),
      creators: ['Tool: license-compliance-service'],
    },
    packages: spdxPackages,
  };
}
