import { CVERecord, CVESeverity, AffectedPackage } from './cve-types';
import { buildInventory } from './dep-inventory';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ZeroDayAlert {
  id: string;
  title: string;
  description: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  source: string;
  epssScore: number | null;
  epssPercentile: number | null;
  cisaKev: boolean;
  cisaKevDueDate: string | null;
  exploitMaturity: 'poc' | 'weaponized' | 'active-campaign' | 'unknown';
  affectedPackages: string[];
  affectsThisRepo: boolean;
  publishedAt: string;
  isEarlyDisclosure: boolean;
}

export interface ActiveThreat {
  alert: ZeroDayAlert;
  installedVersion: string | null;
  patchedVersion: string | null;
  urgency: 'IMMEDIATE' | 'HIGH' | 'ELEVATED' | 'STANDARD';
}

// ── CISA KEV types ───────────────────────────────────────────────────────────

interface CISAKEVEntry {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  shortDescription: string;
  requiredAction: string;
  dueDate: string;
  knownRansomwareCampaignUse: string;
}

interface CISAKEVResponse {
  vulnerabilities: CISAKEVEntry[];
}

// ── EPSS types ───────────────────────────────────────────────────────────────

interface EPSSEntry {
  cve: string;
  epss: string;
  percentile: string;
  date: string;
}

interface EPSSResponse {
  data: EPSSEntry[];
}

// ── OSV types ────────────────────────────────────────────────────────────────

interface OSVSeverity {
  type: string;
  score: string;
}

interface OSVAffected {
  package?: { name: string; ecosystem: string };
  ranges?: Array<{ type: string; events: Array<Record<string, string>> }>;
  versions?: string[];
}

interface OSVVuln {
  id: string;
  summary: string;
  details: string;
  aliases: string[];
  severity: OSVSeverity[];
  affected: OSVAffected[];
  references: Array<{ type: string; url: string }>;
  published?: string;
  modified?: string;
}

interface OSVQueryResponse {
  vulns?: OSVVuln[];
}

// ── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry<T = unknown> {
  data: T;
  timestamp: number;
  ttlMs: number;
}

const TTL = {
  CISA_KEV: 60 * 60 * 1000,       // 1 hour
  EPSS: 24 * 60 * 60 * 1000,      // 24 hours
  OSV: 5 * 60 * 1000,             // 5 minutes
} as const;

const cache = new Map<string, CacheEntry>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > entry.ttlMs) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, { data, timestamp: Date.now(), ttlMs });
}

export function clearCache(): void {
  cache.clear();
}

// ── Data source helpers ──────────────────────────────────────────────────────

const CISA_KEV_URL =
  'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
const EPSS_URL = 'https://api.first.org/data/v1/epss';
const OSV_URL = 'https://api.osv.dev/v1/query';

async function fetchCISAKEV(): Promise<CISAKEVEntry[]> {
  const cached = getCached<CISAKEVEntry[]>('cisa-kev');
  if (cached) return cached;

  try {
    const res = await fetch(CISA_KEV_URL);
    if (!res.ok) {
      console.error(`[Zero-Day] CISA KEV fetch failed: ${res.status} ${res.statusText}`);
      return [];
    }
    const body = (await res.json()) as CISAKEVResponse;
    const vulns = body.vulnerabilities ?? [];
    setCache('cisa-kev', vulns, TTL.CISA_KEV);
    return vulns;
  } catch (err) {
    console.error('[Zero-Day] CISA KEV fetch error:', err);
    return [];
  }
}

async function fetchEPSS(cveId: string): Promise<EPSSEntry | null> {
  const cacheKey = `epss:${cveId}`;
  const cached = getCached<EPSSEntry | null>(cacheKey);
  if (cached !== null) return cached;

  try {
    const res = await fetch(`${EPSS_URL}?cve=${encodeURIComponent(cveId)}`);
    if (!res.ok) {
      console.error(`[Zero-Day] EPSS fetch failed for ${cveId}: ${res.status}`);
      return null;
    }
    const body = (await res.json()) as EPSSResponse;
    const entry = body.data?.[0] ?? null;
    if (entry) setCache(cacheKey, entry, TTL.EPSS);
    return entry;
  } catch (err) {
    console.error(`[Zero-Day] EPSS fetch error for ${cveId}:`, err);
    return null;
  }
}

async function fetchOSV(
  packageName: string,
  version: string,
  ecosystem: string,
): Promise<OSVVuln[]> {
  const cacheKey = `osv:${ecosystem}:${packageName}:${version}`;
  const cached = getCached<OSVVuln[]>(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(OSV_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        package: { name: packageName, ecosystem },
        version,
      }),
    });
    if (!res.ok) {
      console.error(`[Zero-Day] OSV query failed for ${packageName}@${version}: ${res.status}`);
      return [];
    }
    const body = (await res.json()) as OSVQueryResponse;
    const vulns = body.vulns ?? [];
    setCache(cacheKey, vulns, TTL.OSV);
    return vulns;
  } catch (err) {
    console.error(`[Zero-Day] OSV query error for ${packageName}@${version}:`, err);
    return [];
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function severityFromOSV(vuln: OSVVuln): ZeroDayAlert['severity'] {
  for (const s of vuln.severity ?? []) {
    const score = parseFloat(s.score);
    if (!isNaN(score)) {
      if (score >= 9.0) return 'CRITICAL';
      if (score >= 7.0) return 'HIGH';
      if (score >= 4.0) return 'MEDIUM';
      return 'LOW';
    }
  }
  return 'MEDIUM';
}

function maturityFromKEV(entry: CISAKEVEntry): ZeroDayAlert['exploitMaturity'] {
  if (entry.knownRansomwareCampaignUse === 'Known') return 'active-campaign';
  return 'weaponized';
}

function urgencyFromAlert(alert: ZeroDayAlert): ActiveThreat['urgency'] {
  if (alert.cisaKev) return 'IMMEDIATE';
  if (alert.epssScore !== null && alert.epssScore > 0.7) return 'HIGH';
  if (alert.epssScore !== null && alert.epssScore > 0.4) return 'ELEVATED';
  return 'STANDARD';
}

function osvVulnToAlert(vuln: OSVVuln, packageName: string, affectsRepo: boolean): ZeroDayAlert {
  const cveAlias = vuln.aliases?.find(a => a.startsWith('CVE-'));
  const id = cveAlias ?? vuln.id;

  return {
    id,
    title: vuln.summary || vuln.id,
    description: vuln.details || vuln.summary || '',
    severity: severityFromOSV(vuln),
    source: 'OSV',
    epssScore: null,
    epssPercentile: null,
    cisaKev: false,
    cisaKevDueDate: null,
    exploitMaturity: 'unknown',
    affectedPackages: [packageName],
    affectsThisRepo: affectsRepo,
    publishedAt: vuln.published ?? vuln.modified ?? new Date().toISOString(),
    isEarlyDisclosure: !cveAlias,
  };
}

function kevEntryToAlert(entry: CISAKEVEntry): ZeroDayAlert {
  return {
    id: entry.cveID,
    title: entry.vulnerabilityName,
    description: entry.shortDescription,
    severity: 'CRITICAL',
    source: 'CISA KEV',
    epssScore: null,
    epssPercentile: null,
    cisaKev: true,
    cisaKevDueDate: entry.dueDate,
    exploitMaturity: maturityFromKEV(entry),
    affectedPackages: [entry.product],
    affectsThisRepo: false,
    publishedAt: entry.dateAdded,
    isEarlyDisclosure: false,
  };
}

// ── GitHub Advisory DB (GraphQL) helper for early disclosures ────────────────

interface GHSANode {
  ghsaId: string;
  summary: string;
  description: string;
  severity: string;
  publishedAt: string;
  identifiers: Array<{ type: string; value: string }>;
  vulnerabilities: {
    nodes: Array<{
      package: { name: string; ecosystem: string };
      vulnerableVersionRange: string;
      firstPatchedVersion: { identifier: string } | null;
    }>;
  };
}

async function fetchRecentGHSAs(hours: number): Promise<GHSANode[]> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('[Zero-Day] GITHUB_TOKEN not set — cannot query GitHub Advisory DB');
    return [];
  }

  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const query = `
    query($since: DateTime!) {
      securityAdvisories(
        first: 50,
        publishedSince: $since,
        orderBy: { field: PUBLISHED_AT, direction: DESC }
      ) {
        nodes {
          ghsaId
          summary
          description
          severity
          publishedAt
          identifiers { type value }
          vulnerabilities(first: 20) {
            nodes {
              package { name ecosystem }
              vulnerableVersionRange
              firstPatchedVersion { identifier }
            }
          }
        }
      }
    }
  `;

  try {
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'zero-day-service',
      },
      body: JSON.stringify({ query, variables: { since } }),
    });
    if (!res.ok) {
      console.error(`[Zero-Day] GHSA GraphQL failed: ${res.status}`);
      return [];
    }
    const body = (await res.json()) as {
      data?: { securityAdvisories?: { nodes: GHSANode[] } };
    };
    return body.data?.securityAdvisories?.nodes ?? [];
  } catch (err) {
    console.error('[Zero-Day] GHSA GraphQL error:', err);
    return [];
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Queries CISA KEV + EPSS for CVEs with EPSS > 0.7 or on the KEV list,
 * then cross-references with the repo's dependency inventory.
 */
export async function getZeroDayAlerts(): Promise<ZeroDayAlert[]> {
  const alerts: ZeroDayAlert[] = [];
  const inventory = buildInventory();
  const allDeps = inventory.all;

  try {
    // 1. Fetch CISA KEV catalog
    const kevEntries = await fetchCISAKEV();
    const kevByCve = new Map<string, CISAKEVEntry>();
    for (const entry of kevEntries) {
      kevByCve.set(entry.cveID, entry);
    }

    // 2. Query OSV for each direct dependency to discover CVEs
    const osvAlerts: ZeroDayAlert[] = [];
    const directDeps = inventory.direct;
    const osvPromises: Promise<void>[] = [];

    for (const [name, range] of directDeps.entries()) {
      const version = allDeps.get(name) ?? range.replace(/^[\^~>=<\s]+/, '');
      osvPromises.push(
        fetchOSV(name, version, 'npm').then(vulns => {
          for (const v of vulns) {
            osvAlerts.push(osvVulnToAlert(v, name, true));
          }
        }),
      );
    }
    await Promise.all(osvPromises);

    // 3. Enrich OSV alerts with EPSS + KEV data
    const enrichPromises = osvAlerts.map(async alert => {
      const epss = await fetchEPSS(alert.id);
      if (epss) {
        alert.epssScore = parseFloat(epss.epss);
        alert.epssPercentile = parseFloat(epss.percentile);
      }
      const kevEntry = kevByCve.get(alert.id);
      if (kevEntry) {
        alert.cisaKev = true;
        alert.cisaKevDueDate = kevEntry.dueDate;
        alert.exploitMaturity = maturityFromKEV(kevEntry);
        alert.source = 'CISA KEV';
        alert.severity = 'CRITICAL';
      }
    });
    await Promise.all(enrichPromises);

    // 4. Include alerts if EPSS > 0.7 or on KEV list
    for (const alert of osvAlerts) {
      if (alert.cisaKev || (alert.epssScore !== null && alert.epssScore > 0.7)) {
        alerts.push(alert);
      }
    }

    // 5. Add KEV entries that weren't already matched via OSV
    const seenIds = new Set(alerts.map(a => a.id));
    for (const entry of kevEntries) {
      if (seenIds.has(entry.cveID)) continue;
      const alert = kevEntryToAlert(entry);
      // Check if the product matches any repo dependency
      const lowerProduct = entry.product.toLowerCase();
      for (const depName of allDeps.keys()) {
        if (depName.toLowerCase().includes(lowerProduct) || lowerProduct.includes(depName.toLowerCase())) {
          alert.affectsThisRepo = true;
          alert.affectedPackages = [depName];
          break;
        }
      }
      if (alert.affectsThisRepo) {
        alerts.push(alert);
      }
    }
  } catch (err) {
    console.error('[Zero-Day] getZeroDayAlerts error:', err);
  }

  // Sort by severity: CRITICAL > HIGH > MEDIUM > LOW
  const severityOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  alerts.sort((a, b) => (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4));

  return alerts;
}

/**
 * Find advisories published in the last N hours that only have a GHSA ID (no CVE yet).
 */
export async function getEarlyDisclosures(hours: number = 48): Promise<ZeroDayAlert[]> {
  const alerts: ZeroDayAlert[] = [];
  const inventory = buildInventory();
  const allDeps = inventory.all;

  try {
    const ghsaNodes = await fetchRecentGHSAs(hours);

    for (const node of ghsaNodes) {
      const hasCVE = node.identifiers.some(id => id.type === 'CVE');
      if (hasCVE) continue; // Only interested in early disclosures without a CVE

      const affectedPkgs: string[] = [];
      let affectsRepo = false;

      for (const vuln of node.vulnerabilities.nodes) {
        if (vuln.package.ecosystem.toLowerCase() === 'npm') {
          affectedPkgs.push(vuln.package.name);
          if (allDeps.has(vuln.package.name)) {
            affectsRepo = true;
          }
        }
      }

      const severityMap: Record<string, ZeroDayAlert['severity']> = {
        CRITICAL: 'CRITICAL',
        HIGH: 'HIGH',
        MODERATE: 'MEDIUM',
        LOW: 'LOW',
      };

      alerts.push({
        id: node.ghsaId,
        title: node.summary,
        description: node.description,
        severity: severityMap[node.severity] ?? 'MEDIUM',
        source: 'GHSA',
        epssScore: null,
        epssPercentile: null,
        cisaKev: false,
        cisaKevDueDate: null,
        exploitMaturity: 'unknown',
        affectedPackages: affectedPkgs,
        affectsThisRepo: affectsRepo,
        publishedAt: node.publishedAt,
        isEarlyDisclosure: true,
      });
    }
  } catch (err) {
    console.error('[Zero-Day] getEarlyDisclosures error:', err);
  }

  return alerts;
}

/**
 * Get the EPSS score and percentile for a single CVE.
 */
export async function getEPSSScore(
  cveId: string,
): Promise<{ epss: number; percentile: number } | null> {
  try {
    const entry = await fetchEPSS(cveId);
    if (!entry) return null;
    return {
      epss: parseFloat(entry.epss),
      percentile: parseFloat(entry.percentile),
    };
  } catch (err) {
    console.error(`[Zero-Day] getEPSSScore error for ${cveId}:`, err);
    return null;
  }
}

/**
 * Check whether a CVE is on the CISA KEV list.
 */
export async function getCISAKEVStatus(
  cveId: string,
): Promise<{ isKev: boolean; dueDate?: string; action?: string } | null> {
  try {
    const entries = await fetchCISAKEV();
    const match = entries.find(e => e.cveID === cveId);
    if (!match) return { isKev: false };
    return {
      isKev: true,
      dueDate: match.dueDate,
      action: match.requiredAction,
    };
  } catch (err) {
    console.error(`[Zero-Day] getCISAKEVStatus error for ${cveId}:`, err);
    return null;
  }
}

/**
 * Combines zero-day alerts that affect this repo's dependencies,
 * sorted by urgency (IMMEDIATE → STANDARD).
 */
export async function getActiveThreats(): Promise<ActiveThreat[]> {
  const threats: ActiveThreat[] = [];
  const inventory = buildInventory();

  try {
    const [zeroDays, earlyDisclosures] = await Promise.all([
      getZeroDayAlerts(),
      getEarlyDisclosures(),
    ]);

    const allAlerts = [...zeroDays, ...earlyDisclosures];
    const seenIds = new Set<string>();

    for (const alert of allAlerts) {
      if (!alert.affectsThisRepo) continue;
      if (seenIds.has(alert.id)) continue;
      seenIds.add(alert.id);

      let installedVersion: string | null = null;
      let patchedVersion: string | null = null;

      for (const pkgName of alert.affectedPackages) {
        const version = inventory.all.get(pkgName);
        if (version) {
          installedVersion = version;
          break;
        }
      }

      threats.push({
        alert,
        installedVersion,
        patchedVersion,
        urgency: urgencyFromAlert(alert),
      });
    }
  } catch (err) {
    console.error('[Zero-Day] getActiveThreats error:', err);
  }

  const urgencyOrder: Record<string, number> = {
    IMMEDIATE: 0,
    HIGH: 1,
    ELEVATED: 2,
    STANDARD: 3,
  };
  threats.sort((a, b) => (urgencyOrder[a.urgency] ?? 4) - (urgencyOrder[b.urgency] ?? 4));

  return threats;
}

/**
 * Query OSV.dev for known vulnerabilities in a specific package/version.
 */
export async function queryOSV(
  packageName: string,
  version: string,
  ecosystem: string = 'npm',
): Promise<ZeroDayAlert[]> {
  const inventory = buildInventory();
  const affectsRepo = inventory.all.has(packageName);

  try {
    const vulns = await fetchOSV(packageName, version, ecosystem);
    return vulns.map(v => osvVulnToAlert(v, packageName, affectsRepo));
  } catch (err) {
    console.error(`[Zero-Day] queryOSV error for ${packageName}@${version}:`, err);
    return [];
  }
}
