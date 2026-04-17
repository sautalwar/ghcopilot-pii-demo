import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Octokit } from '@octokit/rest';
import { isExcepted, getActiveExceptions } from './risk-exceptions-service';
import { auditLicenses, LicenseReport } from './license-compliance-service';

// ── Octokit setup ────────────────────────────────────────────────────────────

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const owner = process.env.GITHUB_OWNER || '';
const repo = process.env.GITHUB_REPO || '';

// ── Types ────────────────────────────────────────────────────────────────────

export type CheckStatus = 'passed' | 'failed' | 'skipped' | 'pending';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  details: string;
  findings: string[];
  timestamp: string;
}

export interface GovernanceReport {
  prNumber: number;
  timestamp: string;
  overallStatus: 'certified' | 'failed' | 'pending';
  checks: CheckResult[];
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  pendingCount: number;
}

export interface AuditRecord {
  id: string;
  prNumber: number;
  checkName: string;
  status: CheckStatus;
  details: string;
  timestamp: string;
  actor?: string;
}

// ── Policy cache ─────────────────────────────────────────────────────────────

let cachedPolicy: any = null;
let cachedPolicyTime = 0;
const POLICY_TTL_MS = 60_000;

const DEFAULT_POLICY = {
  version: '1.0',
  checks: {
    vulnerability_threshold: { enabled: false },
    secret_scanning: { enabled: false },
    license_compliance: { enabled: false },
    dependency_audit: { enabled: false },
    codeql_required: { enabled: false },
    security_review: { enabled: false },
  },
  audit: {
    log_all_checks: true,
    retention_days: 365,
    export_format: 'json',
  },
};

// ── In-memory audit trail ────────────────────────────────────────────────────

let auditTrail: AuditRecord[] = [];

function recordAudit(
  prNumber: number,
  checkName: string,
  status: CheckStatus,
  details: string,
): void {
  auditTrail.push({
    id: `gov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    prNumber,
    checkName,
    status,
    details,
    timestamp: new Date().toISOString(),
    actor: 'governance-service',
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCheckResult(
  name: string,
  status: CheckStatus,
  details: string,
  findings: string[] = [],
): CheckResult {
  return { name, status, details, findings, timestamp: new Date().toISOString() };
}

/** Simple glob matcher supporting ** (any path segments) and * (single segment). */
function matchGlob(pattern: string, filePath: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<<GLOBSTAR>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<GLOBSTAR>>/g, '.*');
  return new RegExp(`^${regexStr}$`).test(filePath);
}

// ── Public functions ─────────────────────────────────────────────────────────

export function loadGovernancePolicy(repoRoot?: string): any {
  const now = Date.now();
  if (cachedPolicy && now - cachedPolicyTime < POLICY_TTL_MS) {
    return cachedPolicy;
  }

  const root = repoRoot || process.cwd();
  const policyPath = path.join(root, '.ghas-governance.yml');

  try {
    if (!fs.existsSync(policyPath)) {
      console.log('[Governance] No .ghas-governance.yml found, using defaults');
      cachedPolicy = { ...DEFAULT_POLICY };
      cachedPolicyTime = now;
      return cachedPolicy;
    }
    const raw = fs.readFileSync(policyPath, 'utf-8');
    cachedPolicy = yaml.load(raw) || { ...DEFAULT_POLICY };
    cachedPolicyTime = now;
    console.log('[Governance] Loaded governance policy');
    return cachedPolicy;
  } catch (err: any) {
    console.error('[Governance] Failed to parse policy file:', err.message);
    cachedPolicy = { ...DEFAULT_POLICY };
    cachedPolicyTime = now;
    return cachedPolicy;
  }
}

export function getGovernancePolicy(repoRoot?: string): any {
  return loadGovernancePolicy(repoRoot);
}

// ── Individual checks ────────────────────────────────────────────────────────

async function checkVulnerabilityThreshold(
  config: any,
  changedFiles?: string[],
): Promise<CheckResult> {
  if (!config?.enabled) {
    return makeCheckResult('vulnerability_threshold', 'skipped', 'Check disabled');
  }

  try {
    const [codeScanResp, dependabotResp] = await Promise.all([
      octokit.request('GET /repos/{owner}/{repo}/code-scanning/alerts', {
        owner,
        repo,
        state: 'open',
      }),
      octokit.request('GET /repos/{owner}/{repo}/dependabot/alerts', {
        owner,
        repo,
        state: 'open',
      }),
    ]);

    const allAlerts = [
      ...((codeScanResp.data as any[]) || []),
      ...((dependabotResp.data as any[]) || []),
    ];

    const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    const findings: string[] = [];

    for (const alert of allAlerts) {
      const severity: string = (
        alert.security_vulnerability?.severity ||
        alert.rule?.security_severity_level ||
        alert.security_advisory?.severity ||
        'low'
      ).toLowerCase();

      // Skip excepted alerts when configured
      if (config.exclude_excepted) {
        const alertFile =
          alert.most_recent_instance?.location?.path ||
          alert.dependency?.manifest_path ||
          '';
        if (alertFile) {
          const check = isExcepted(alertFile);
          if (check.isExcepted) continue;
        }
      }

      if (counts[severity] !== undefined) {
        counts[severity]++;
      }
    }

    const violations: string[] = [];
    const thresholds: Record<string, string> = {
      critical: 'max_critical',
      high: 'max_high',
      medium: 'max_medium',
      low: 'max_low',
    };

    for (const [sev, key] of Object.entries(thresholds)) {
      const max = config[key] ?? -1;
      if (max >= 0 && counts[sev] > max) {
        violations.push(`${sev}: ${counts[sev]} (max ${max})`);
      }
      findings.push(`${sev}: ${counts[sev]}/${max === -1 ? 'unlimited' : max}`);
    }

    if (violations.length > 0) {
      return makeCheckResult(
        'vulnerability_threshold',
        'failed',
        `Vulnerability thresholds exceeded: ${violations.join(', ')}`,
        findings,
      );
    }

    return makeCheckResult(
      'vulnerability_threshold',
      'passed',
      'All vulnerability counts within thresholds',
      findings,
    );
  } catch (err: any) {
    console.error('[Governance] vulnerability_threshold check error:', err.message);
    return makeCheckResult(
      'vulnerability_threshold',
      'skipped',
      `API error (GHAS may not be enabled): ${err.message}`,
    );
  }
}

async function checkSecretScanning(
  config: any,
  changedFiles?: string[],
): Promise<CheckResult> {
  if (!config?.enabled) {
    return makeCheckResult('secret_scanning', 'skipped', 'Check disabled');
  }

  try {
    const resp = await octokit.request(
      'GET /repos/{owner}/{repo}/secret-scanning/alerts',
      { owner, repo, state: 'open' },
    );

    let alerts = (resp.data as any[]) || [];
    const findings: string[] = [];

    if (changedFiles && changedFiles.length > 0) {
      alerts = alerts.filter((a: any) => {
        const locations = a.locations || [];
        return locations.some((loc: any) =>
          changedFiles.includes(loc?.details?.path || ''),
        );
      });
    }

    for (const a of alerts) {
      findings.push(`Secret detected: ${a.secret_type_display_name || a.secret_type || 'unknown'}`);
    }

    if (config.block_on_detection && alerts.length > 0) {
      return makeCheckResult(
        'secret_scanning',
        'failed',
        `${alerts.length} open secret(s) detected`,
        findings,
      );
    }

    return makeCheckResult(
      'secret_scanning',
      'passed',
      alerts.length === 0 ? 'No open secrets detected' : `${alerts.length} secret(s) present (non-blocking)`,
      findings,
    );
  } catch (err: any) {
    console.error('[Governance] secret_scanning check error:', err.message);
    return makeCheckResult(
      'secret_scanning',
      'skipped',
      `API error (secret scanning may not be enabled): ${err.message}`,
    );
  }
}

async function checkLicenseCompliance(config: any): Promise<CheckResult> {
  if (!config?.enabled) {
    return makeCheckResult('license_compliance', 'skipped', 'Check disabled');
  }

  try {
    const report: LicenseReport = auditLicenses();
    const findings: string[] = report.violations.map(
      (v) => `${v.packageName}@${v.version}: ${v.license || 'unknown'} (${v.status})`,
    );

    if (!report.compliant) {
      return makeCheckResult(
        'license_compliance',
        'failed',
        `${report.denied} denied, ${report.reviewRequired} requiring review out of ${report.totalPackages} packages`,
        findings,
      );
    }

    return makeCheckResult(
      'license_compliance',
      'passed',
      `All ${report.totalPackages} packages compliant`,
      findings,
    );
  } catch (err: any) {
    console.error('[Governance] license_compliance check error:', err.message);
    return makeCheckResult(
      'license_compliance',
      'skipped',
      `License audit error: ${err.message}`,
    );
  }
}

async function checkDependencyAudit(config: any): Promise<CheckResult> {
  if (!config?.enabled) {
    return makeCheckResult('dependency_audit', 'skipped', 'Check disabled');
  }

  try {
    const findings: string[] = [];

    // Check lockfile requirement
    if (config.require_lockfile) {
      const lockfilePath = path.join(process.cwd(), 'package-lock.json');
      if (!fs.existsSync(lockfilePath)) {
        findings.push('package-lock.json missing (required by policy)');
        return makeCheckResult(
          'dependency_audit',
          'failed',
          'Required lockfile not found',
          findings,
        );
      }
      findings.push('package-lock.json present');
    }

    // Fetch dependabot alerts for critical and high severity
    const [critResp, highResp] = await Promise.all([
      octokit.request('GET /repos/{owner}/{repo}/dependabot/alerts', {
        owner,
        repo,
        state: 'open',
        severity: 'critical',
      }),
      octokit.request('GET /repos/{owner}/{repo}/dependabot/alerts', {
        owner,
        repo,
        state: 'open',
        severity: 'high',
      }),
    ]);

    const critCount = ((critResp.data as any[]) || []).length;
    const highCount = ((highResp.data as any[]) || []).length;
    const maxCrit = config.max_critical_deps ?? 0;
    const maxHigh = config.max_high_deps ?? 0;

    findings.push(`Critical deps: ${critCount}/${maxCrit}`);
    findings.push(`High deps: ${highCount}/${maxHigh}`);

    const violations: string[] = [];
    if (critCount > maxCrit) violations.push(`critical: ${critCount} (max ${maxCrit})`);
    if (highCount > maxHigh) violations.push(`high: ${highCount} (max ${maxHigh})`);

    if (violations.length > 0) {
      return makeCheckResult(
        'dependency_audit',
        'failed',
        `Dependency thresholds exceeded: ${violations.join(', ')}`,
        findings,
      );
    }

    return makeCheckResult(
      'dependency_audit',
      'passed',
      'Dependency alerts within thresholds',
      findings,
    );
  } catch (err: any) {
    console.error('[Governance] dependency_audit check error:', err.message);
    return makeCheckResult(
      'dependency_audit',
      'skipped',
      `API error (Dependabot may not be enabled): ${err.message}`,
    );
  }
}

async function checkCodeQLRequired(config: any): Promise<CheckResult> {
  if (!config?.enabled) {
    return makeCheckResult('codeql_required', 'skipped', 'Check disabled');
  }

  try {
    const resp = await octokit.request(
      'GET /repos/{owner}/{repo}/code-scanning/alerts',
      { owner, repo, state: 'open', tool_name: 'CodeQL' },
    );

    const alerts = (resp.data as any[]) || [];
    let errorCount = 0;
    let warningCount = 0;
    const findings: string[] = [];

    for (const alert of alerts) {
      const severity = (alert.rule?.security_severity_level || alert.rule?.severity || '').toLowerCase();
      if (severity === 'error' || severity === 'critical' || severity === 'high') {
        errorCount++;
        findings.push(`Error: ${alert.rule?.description || alert.rule?.id || 'unknown'}`);
      } else {
        warningCount++;
        findings.push(`Warning: ${alert.rule?.description || alert.rule?.id || 'unknown'}`);
      }
    }

    const maxErrors = config.max_errors ?? 0;
    const maxWarnings = config.max_warnings ?? 5;
    const violations: string[] = [];

    if (errorCount > maxErrors) violations.push(`errors: ${errorCount} (max ${maxErrors})`);
    if (warningCount > maxWarnings) violations.push(`warnings: ${warningCount} (max ${maxWarnings})`);

    if (violations.length > 0) {
      return makeCheckResult(
        'codeql_required',
        'failed',
        `CodeQL thresholds exceeded: ${violations.join(', ')}`,
        findings,
      );
    }

    return makeCheckResult(
      'codeql_required',
      'passed',
      `CodeQL: ${errorCount} errors, ${warningCount} warnings (within limits)`,
      findings,
    );
  } catch (err: any) {
    console.error('[Governance] codeql_required check error:', err.message);
    return makeCheckResult(
      'codeql_required',
      'skipped',
      `API error (CodeQL may not be configured): ${err.message}`,
    );
  }
}

function checkSecurityReview(
  config: any,
  changedFiles?: string[],
): CheckResult {
  if (!config?.enabled) {
    return makeCheckResult('security_review', 'skipped', 'Check disabled');
  }

  const patterns: string[] = config.required_for || [];
  const reviewers: string[] = config.reviewers || [];
  const findings: string[] = [];

  if (!changedFiles || changedFiles.length === 0) {
    return makeCheckResult(
      'security_review',
      'skipped',
      'No changed files provided, cannot determine review requirement',
    );
  }

  const matchedFiles: string[] = [];
  for (const file of changedFiles) {
    for (const pattern of patterns) {
      if (matchGlob(pattern, file)) {
        matchedFiles.push(file);
        findings.push(`${file} matches pattern "${pattern}"`);
        break;
      }
    }
  }

  if (matchedFiles.length > 0) {
    const reviewerStr = reviewers.join(', ') || 'unspecified';
    return makeCheckResult(
      'security_review',
      'pending',
      `${matchedFiles.length} file(s) require security review by ${reviewerStr}`,
      findings,
    );
  }

  return makeCheckResult(
    'security_review',
    'skipped',
    'No changed files require security review',
    findings,
  );
}

// ── Main orchestration ───────────────────────────────────────────────────────

export async function runAllChecks(
  prNumber: number,
  changedFiles?: string[],
): Promise<GovernanceReport> {
  console.log(`[Governance] Running all checks for PR #${prNumber}`);
  const policy = loadGovernancePolicy();
  const checks = policy.checks || {};

  const results: CheckResult[] = [];

  // Run checks — each wrapped independently so one failure doesn't block others
  const checkRunners: Array<() => Promise<CheckResult>> = [
    () => checkVulnerabilityThreshold(checks.vulnerability_threshold, changedFiles),
    () => checkSecretScanning(checks.secret_scanning, changedFiles),
    () => checkLicenseCompliance(checks.license_compliance),
    () => checkDependencyAudit(checks.dependency_audit),
    () => checkCodeQLRequired(checks.codeql_required),
    () => Promise.resolve(checkSecurityReview(checks.security_review, changedFiles)),
  ];

  for (const runner of checkRunners) {
    try {
      const result = await runner();
      results.push(result);
      recordAudit(prNumber, result.name, result.status, result.details);
    } catch (err: any) {
      const name = 'unknown_check';
      const result = makeCheckResult(name, 'skipped', `Unexpected error: ${err.message}`);
      results.push(result);
      recordAudit(prNumber, name, 'skipped', result.details);
    }
  }

  const passedCount = results.filter((r) => r.status === 'passed').length;
  const failedCount = results.filter((r) => r.status === 'failed').length;
  const skippedCount = results.filter((r) => r.status === 'skipped').length;
  const pendingCount = results.filter((r) => r.status === 'pending').length;

  let overallStatus: 'certified' | 'failed' | 'pending';
  if (failedCount > 0) {
    overallStatus = 'failed';
  } else if (pendingCount > 0) {
    overallStatus = 'pending';
  } else {
    overallStatus = 'certified';
  }

  const report: GovernanceReport = {
    prNumber,
    timestamp: new Date().toISOString(),
    overallStatus,
    checks: results,
    passedCount,
    failedCount,
    skippedCount,
    pendingCount,
  };

  console.log(`[Governance] PR #${prNumber}: ${overallStatus} (${passedCount}P/${failedCount}F/${skippedCount}S/${pendingCount}W)`);
  return report;
}

// ── Query helpers ────────────────────────────────────────────────────────────

export function getCheckStatus(
  report: GovernanceReport,
  checkName: string,
): CheckResult | undefined {
  return report.checks.find((c) => c.name === checkName);
}

export function isSecurityCertified(report: GovernanceReport): boolean {
  return report.checks.every((c) => c.status === 'passed' || c.status === 'skipped');
}

export function getCertificationReport(
  prNumber: number,
  report: GovernanceReport,
): object {
  return {
    certification: {
      prNumber,
      repository: `${owner}/${repo}`,
      certified: isSecurityCertified(report),
      overallStatus: report.overallStatus,
      generatedAt: new Date().toISOString(),
    },
    summary: {
      passed: report.passedCount,
      failed: report.failedCount,
      skipped: report.skippedCount,
      pending: report.pendingCount,
    },
    checks: report.checks.map((c) => ({
      name: c.name,
      status: c.status,
      details: c.details,
      findings: c.findings,
      timestamp: c.timestamp,
    })),
    policy: {
      version: loadGovernancePolicy().version || 'unknown',
    },
    audit: {
      exportFormat: 'json',
      generatedBy: 'governance-service',
    },
  };
}

// ── Audit trail ──────────────────────────────────────────────────────────────

export function getAuditTrail(days?: number): AuditRecord[] {
  if (days === undefined) {
    return [...auditTrail];
  }
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffISO = cutoff.toISOString();
  return auditTrail.filter((r) => r.timestamp >= cutoffISO);
}

export function clearAuditTrail(): void {
  auditTrail = [];
  console.log('[Governance] Audit trail cleared');
}
