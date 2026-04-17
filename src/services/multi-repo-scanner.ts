import { Octokit } from '@octokit/rest';

// ── Types ──────────────────────────────────────────────────────────────────

export interface RepoInfo {
  name: string;
  fullName: string;
  htmlUrl: string;
  language: string | null;
  defaultBranch: string;
  updatedAt: string;
  isPrivate: boolean;
  hasSecurityAlerts: boolean;
}

export interface SecurityFinding {
  id: string;
  repo: string;
  type: 'code-scanning' | 'secret-scanning' | 'dependabot' | 'secret-pattern';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  file?: string;
  line?: number;
  package?: string;
  cveId?: string;
  state: 'open' | 'fixed' | 'dismissed';
  createdAt: string;
  htmlUrl?: string;
  fixDescription?: string;
}

export interface RepoScanResult {
  repo: RepoInfo;
  findings: SecurityFinding[];
  scanDurationMs: number;
  scannedAt: string;
}

export interface MultiRepoScanResult {
  repos: RepoScanResult[];
  summary: {
    totalRepos: number;
    scannedRepos: number;
    totalFindings: number;
    bySeverity: { critical: number; high: number; medium: number; low: number };
    byType: { codeScanning: number; secretScanning: number; dependabot: number; secretPattern: number };
    scanDurationMs: number;
  };
}

// ── Shared Octokit instance ────────────────────────────────────────────────

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const PREFIX = '[MultiRepoScanner]';

// ── Helpers ────────────────────────────────────────────────────────────────

function normalizeSeverity(raw: string | undefined | null): SecurityFinding['severity'] {
  const s = (raw ?? '').toLowerCase();
  if (s === 'critical') return 'critical';
  if (s === 'high') return 'high';
  if (s === 'medium' || s === 'warning') return 'medium';
  return 'low';
}

function normalizeState(raw: string | undefined | null): SecurityFinding['state'] {
  const s = (raw ?? '').toLowerCase();
  if (s === 'fixed' || s === 'resolved') return 'fixed';
  if (s === 'dismissed') return 'dismissed';
  return 'open';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Code scanning alerts ───────────────────────────────────────────────────

async function fetchCodeScanningAlerts(owner: string, repo: string): Promise<SecurityFinding[]> {
  try {
    const { data } = await octokit.codeScanning.listAlertsForRepo({
      owner,
      repo,
      per_page: 100,
      state: 'open',
    });

    return (data as any[]).map((alert: any) => ({
      id: `cs-${owner}-${repo}-${alert.number}`,
      repo: `${owner}/${repo}`,
      type: 'code-scanning' as const,
      severity: normalizeSeverity(
        alert.rule?.security_severity_level ?? alert.rule?.severity
      ),
      title: alert.rule?.description ?? alert.rule?.id ?? 'Code scanning alert',
      description: alert.most_recent_instance?.message?.text ?? alert.rule?.description ?? '',
      file: alert.most_recent_instance?.location?.path,
      line: alert.most_recent_instance?.location?.start_line,
      state: normalizeState(alert.state),
      createdAt: alert.created_at ?? new Date().toISOString(),
      htmlUrl: alert.html_url,
    }));
  } catch (err: any) {
    if (err.status === 403 || err.status === 404) {
      return [];
    }
    console.error(`${PREFIX} Code scanning error for ${owner}/${repo}:`, err.message);
    return [];
  }
}

// ── Secret scanning alerts ─────────────────────────────────────────────────

async function fetchSecretScanningAlerts(owner: string, repo: string): Promise<SecurityFinding[]> {
  try {
    const { data } = await octokit.secretScanning.listAlertsForRepo({
      owner,
      repo,
      per_page: 100,
      state: 'open',
    });

    return (data as any[]).map((alert: any) => ({
      id: `ss-${owner}-${repo}-${alert.number}`,
      repo: `${owner}/${repo}`,
      type: 'secret-scanning' as const,
      severity: 'critical' as const,
      title: `Exposed secret: ${alert.secret_type_display_name ?? alert.secret_type ?? 'unknown'}`,
      description: `Secret of type "${alert.secret_type ?? 'unknown'}" detected`,
      file: alert.locations?.[0]?.path,
      state: normalizeState(alert.state),
      createdAt: alert.created_at ?? new Date().toISOString(),
      htmlUrl: alert.html_url,
    }));
  } catch (err: any) {
    if (err.status === 403 || err.status === 404) {
      return [];
    }
    console.error(`${PREFIX} Secret scanning error for ${owner}/${repo}:`, err.message);
    return [];
  }
}

// ── Dependabot alerts ──────────────────────────────────────────────────────

async function fetchDependabotAlerts(owner: string, repo: string): Promise<SecurityFinding[]> {
  try {
    const { data } = await octokit.dependabot.listAlertsForRepo({
      owner,
      repo,
      per_page: 100,
      state: 'open',
    } as any);

    return (data as any[]).map((alert: any) => {
      const advisory = alert.security_advisory;
      const vuln = alert.security_vulnerability;
      return {
        id: `dep-${owner}-${repo}-${alert.number}`,
        repo: `${owner}/${repo}`,
        type: 'dependabot' as const,
        severity: normalizeSeverity(advisory?.severity),
        title: advisory?.summary ?? 'Dependabot alert',
        description: advisory?.description?.slice(0, 300) ?? '',
        package: vuln?.package?.name,
        cveId: advisory?.cve_id ?? undefined,
        state: normalizeState(alert.state),
        createdAt: alert.created_at ?? new Date().toISOString(),
        htmlUrl: alert.html_url,
        fixDescription: vuln?.first_patched_version?.identifier
          ? `Upgrade to ${vuln.first_patched_version.identifier}`
          : undefined,
      };
    });
  } catch (err: any) {
    if (err.status === 403 || err.status === 404) {
      return [];
    }
    console.error(`${PREFIX} Dependabot error for ${owner}/${repo}:`, err.message);
    return [];
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function listUserRepos(username?: string): Promise<RepoInfo[]> {
  const user = username ?? process.env.GITHUB_OWNER ?? 'sautalwar';

  try {
    const { data } = await octokit.repos.listForUser({
      username: user,
      type: 'owner',
      sort: 'updated',
      per_page: 100,
    });

    return data
      .sort((a, b) => new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime())
      .map((r) => ({
        name: r.name,
        fullName: r.full_name,
        htmlUrl: r.html_url,
        language: r.language ?? null,
        defaultBranch: r.default_branch ?? 'main',
        updatedAt: r.updated_at ?? new Date().toISOString(),
        isPrivate: r.private,
        hasSecurityAlerts: false, // updated after scanning
      }));
  } catch (err: any) {
    console.error(`${PREFIX} Failed to list repos for ${user}:`, err.message);
    return [];
  }
}

export async function scanRepo(repoFullName: string): Promise<RepoScanResult> {
  const [owner, repo] = repoFullName.split('/');
  const start = Date.now();

  const [codeScanFindings, secretFindings, dependabotFindings] = await Promise.all([
    fetchCodeScanningAlerts(owner, repo),
    fetchSecretScanningAlerts(owner, repo),
    fetchDependabotAlerts(owner, repo),
  ]);

  const findings = [...codeScanFindings, ...secretFindings, ...dependabotFindings];

  return {
    repo: {
      name: repo,
      fullName: repoFullName,
      htmlUrl: `https://github.com/${repoFullName}`,
      language: null,
      defaultBranch: 'main',
      updatedAt: new Date().toISOString(),
      isPrivate: false,
      hasSecurityAlerts: findings.length > 0,
    },
    findings,
    scanDurationMs: Date.now() - start,
    scannedAt: new Date().toISOString(),
  };
}

export async function scanAllRepos(username?: string): Promise<MultiRepoScanResult> {
  const overallStart = Date.now();
  const repos = await listUserRepos(username);
  const results: RepoScanResult[] = [];

  for (const repoInfo of repos) {
    const result = await scanRepo(repoInfo.fullName);
    // Carry forward the richer repo metadata from listUserRepos
    result.repo = { ...repoInfo, hasSecurityAlerts: result.findings.length > 0 };
    results.push(result);
    await delay(500);
  }

  const allFindings = results.flatMap((r) => r.findings);

  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  const byType = { codeScanning: 0, secretScanning: 0, dependabot: 0, secretPattern: 0 };

  for (const f of allFindings) {
    bySeverity[f.severity]++;
    if (f.type === 'code-scanning') byType.codeScanning++;
    else if (f.type === 'secret-scanning') byType.secretScanning++;
    else if (f.type === 'dependabot') byType.dependabot++;
    else if (f.type === 'secret-pattern') byType.secretPattern++;
  }

  return {
    repos: results,
    summary: {
      totalRepos: repos.length,
      scannedRepos: results.length,
      totalFindings: allFindings.length,
      bySeverity,
      byType,
      scanDurationMs: Date.now() - overallStart,
    },
  };
}
