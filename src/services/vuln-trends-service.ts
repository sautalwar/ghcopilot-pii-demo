import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { Octokit } from '@octokit/rest';
import {
  VulnEvent,
  VulnSnapshot,
  TimelinePoint,
  MTTRResult,
  RemediationRate,
  CopilotImpact,
  AgeBucket,
  TrendSummary,
} from './vuln-trends-types';

const DB_PATH = path.join(process.cwd(), 'data', 'vuln-trends.db');
let db: Database.Database;

// ── Database init ──────────────────────────────────────────────────────────

export function initDB(): void {
  fs.mkdirSync(path.join(process.cwd(), 'data'), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS vuln_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_type TEXT NOT NULL,
      alert_number INTEGER NOT NULL,
      state TEXT NOT NULL,
      severity TEXT,
      package_name TEXT,
      cve_id TEXT,
      file_path TEXT,
      fixed_by TEXT,
      opened_at TEXT NOT NULL,
      resolved_at TEXT,
      event_timestamp TEXT NOT NULL,
      jira_key TEXT,
      UNIQUE(alert_type, alert_number, state, event_timestamp)
    );

    CREATE TABLE IF NOT EXISTS vuln_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_date TEXT NOT NULL UNIQUE,
      total_open INTEGER NOT NULL,
      critical_open INTEGER NOT NULL,
      high_open INTEGER NOT NULL,
      medium_open INTEGER NOT NULL,
      low_open INTEGER NOT NULL,
      fixed_today INTEGER NOT NULL,
      mttr_hours REAL
    );
  `);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickWeighted<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// ── Record a single event ──────────────────────────────────────────────────

const insertEventStmt = () =>
  db.prepare(`
    INSERT OR IGNORE INTO vuln_events
      (alert_type, alert_number, state, severity, package_name, cve_id,
       file_path, fixed_by, opened_at, resolved_at, event_timestamp, jira_key)
    VALUES
      (@alert_type, @alert_number, @state, @severity, @package_name, @cve_id,
       @file_path, @fixed_by, @opened_at, @resolved_at, @event_timestamp, @jira_key)
  `);

export function recordEvent(event: VulnEvent): void {
  insertEventStmt().run({
    alert_type: event.alertType,
    alert_number: event.alertNumber,
    state: event.state,
    severity: event.severity,
    package_name: event.packageName,
    cve_id: event.cveId,
    file_path: event.filePath,
    fixed_by: event.fixedBy,
    opened_at: event.openedAt,
    resolved_at: event.resolvedAt,
    event_timestamp: event.eventTimestamp,
    jira_key: event.jiraKey,
  });
}

// ── Take a daily snapshot ──────────────────────────────────────────────────

const insertSnapshotStmt = () =>
  db.prepare(`
    INSERT OR REPLACE INTO vuln_snapshots
      (snapshot_date, total_open, critical_open, high_open, medium_open, low_open, fixed_today, mttr_hours)
    VALUES
      (@snapshot_date, @total_open, @critical_open, @high_open, @medium_open, @low_open, @fixed_today, @mttr_hours)
  `);

export function takeSnapshot(): void {
  const today = toISODate(new Date());

  const openCounts = db
    .prepare(
      `SELECT severity, COUNT(*) as cnt
       FROM vuln_events
       WHERE state = 'open'
       GROUP BY severity`
    )
    .all() as Array<{ severity: string | null; cnt: number }>;

  const sevMap: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  let totalOpen = 0;
  for (const row of openCounts) {
    const key = row.severity ?? 'low';
    sevMap[key] = (sevMap[key] || 0) + row.cnt;
    totalOpen += row.cnt;
  }

  const fixedToday = (
    db
      .prepare(
        `SELECT COUNT(*) as cnt FROM vuln_events
         WHERE state = 'fixed' AND DATE(event_timestamp) = ?`
      )
      .get(today) as { cnt: number }
  ).cnt;

  const mttrRow = db
    .prepare(
      `SELECT AVG(
         (julianday(resolved_at) - julianday(opened_at)) * 24
       ) as mttr
       FROM vuln_events
       WHERE state = 'fixed' AND resolved_at IS NOT NULL`
    )
    .get() as { mttr: number | null };

  insertSnapshotStmt().run({
    snapshot_date: today,
    total_open: totalOpen,
    critical_open: sevMap.critical,
    high_open: sevMap.high,
    medium_open: sevMap.medium,
    low_open: sevMap.low,
    fixed_today: fixedToday,
    mttr_hours: mttrRow.mttr,
  });
}

// ── Seed from GitHub APIs ──────────────────────────────────────────────────

export async function seedFromGitHub(): Promise<{ eventsAdded: number; snapshotsGenerated: number }> {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;

  if (!token || !owner || !repo) {
    throw new Error('GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO env vars are required');
  }

  const octokit = new Octokit({ auth: token });
  let eventsAdded = 0;

  // Dependabot alerts
  try {
    const dependabotAlerts = await octokit.paginate(
      'GET /repos/{owner}/{repo}/dependabot/alerts',
      { owner, repo, per_page: 100 }
    );
    for (const alert of dependabotAlerts) {
      const a = alert as Record<string, any>;
      const event: VulnEvent = {
        alertType: 'dependabot',
        alertNumber: a.number,
        state: a.state === 'open' ? 'open' : a.state === 'fixed' ? 'fixed' : 'dismissed',
        severity: a.security_advisory?.severity?.toLowerCase() ?? null,
        packageName: a.dependency?.package?.name ?? null,
        cveId: a.security_advisory?.cve_id ?? null,
        filePath: a.dependency?.manifest_path ?? null,
        fixedBy: a.state === 'fixed' ? 'dependabot-auto' : null,
        openedAt: a.created_at,
        resolvedAt: a.fixed_at ?? a.dismissed_at ?? null,
        eventTimestamp: new Date().toISOString(),
        jiraKey: null,
      };
      recordEvent(event);
      eventsAdded++;
    }
  } catch {
    // Dependabot API may not be available; continue
  }

  // Code scanning alerts
  try {
    const codeScanAlerts = await octokit.paginate(
      'GET /repos/{owner}/{repo}/code-scanning/alerts',
      { owner, repo, per_page: 100 }
    );
    for (const alert of codeScanAlerts) {
      const a = alert as Record<string, any>;
      const event: VulnEvent = {
        alertType: 'code_scanning',
        alertNumber: a.number,
        state: a.state === 'open' ? 'open' : a.state === 'fixed' ? 'fixed' : 'dismissed',
        severity: a.rule?.security_severity_level ?? a.rule?.severity ?? null,
        packageName: null,
        cveId: a.rule?.id ?? null,
        filePath: a.most_recent_instance?.location?.path ?? null,
        fixedBy: a.state === 'fixed' ? 'human' : null,
        openedAt: a.created_at,
        resolvedAt: a.fixed_at ?? a.dismissed_at ?? null,
        eventTimestamp: new Date().toISOString(),
        jiraKey: null,
      };
      recordEvent(event);
      eventsAdded++;
    }
  } catch {
    // Code scanning may not be enabled; continue
  }

  // Secret scanning alerts
  try {
    const secretAlerts = await octokit.paginate(
      'GET /repos/{owner}/{repo}/secret-scanning/alerts',
      { owner, repo, per_page: 100 }
    );
    for (const alert of secretAlerts) {
      const a = alert as Record<string, any>;
      const event: VulnEvent = {
        alertType: 'secret_scanning',
        alertNumber: a.number,
        state: a.state === 'open' ? 'open' : a.state === 'resolved' ? 'fixed' : 'dismissed',
        severity: 'critical',
        packageName: null,
        cveId: null,
        filePath: null,
        fixedBy: a.state === 'resolved' ? 'human' : null,
        openedAt: a.created_at,
        resolvedAt: a.resolved_at ?? null,
        eventTimestamp: new Date().toISOString(),
        jiraKey: null,
      };
      recordEvent(event);
      eventsAdded++;
    }
  } catch {
    // Secret scanning may not be enabled; continue
  }

  takeSnapshot();
  return { eventsAdded, snapshotsGenerated: 1 };
}

// ── Generate demo data ─────────────────────────────────────────────────────

export function generateDemoData(): { eventsGenerated: number; snapshotsGenerated: number } {
  const severities: Array<'critical' | 'high' | 'medium' | 'low'> = ['critical', 'high', 'medium', 'low'];
  const fixSources: Array<'copilot' | 'human' | 'dependabot-auto'> = ['copilot', 'human', 'dependabot-auto'];
  const fixWeights = [70, 20, 10];

  // Current open counts per severity
  const openCounts: Record<string, number> = { critical: 15, high: 25, medium: 30, low: 20 };
  // Prioritize fixing critical/high
  const fixPriority = [4, 3, 2, 1];

  let alertCounter = 1000;
  let eventsGenerated = 0;
  let snapshotsGenerated = 0;

  const insertEvent = db.prepare(`
    INSERT OR IGNORE INTO vuln_events
      (alert_type, alert_number, state, severity, package_name, cve_id,
       file_path, fixed_by, opened_at, resolved_at, event_timestamp, jira_key)
    VALUES
      (@alert_type, @alert_number, @state, @severity, @package_name, @cve_id,
       @file_path, @fixed_by, @opened_at, @resolved_at, @event_timestamp, @jira_key)
  `);

  const insertSnap = db.prepare(`
    INSERT OR REPLACE INTO vuln_snapshots
      (snapshot_date, total_open, critical_open, high_open, medium_open, low_open, fixed_today, mttr_hours)
    VALUES
      (@snapshot_date, @total_open, @critical_open, @high_open, @medium_open, @low_open, @fixed_today, @mttr_hours)
  `);

  const batchInsert = db.transaction(() => {
    for (let dayOffset = 90; dayOffset >= 0; dayOffset--) {
      const day = daysAgo(dayOffset);
      const dayISO = toISODate(day);
      const dayTimestamp = day.toISOString();
      let fixedToday = 0;

      // Fix 1-3 vulns, weighted toward critical/high
      const fixCount = randomInt(1, 3);
      for (let f = 0; f < fixCount; f++) {
        const sev = pickWeighted(severities, fixPriority);
        if (openCounts[sev] <= 0) continue;

        openCounts[sev]--;
        fixedToday++;
        alertCounter++;

        const openedDaysAgo = randomInt(dayOffset + 1, dayOffset + 30);
        const openedDate = daysAgo(openedDaysAgo);

        insertEvent.run({
          alert_type: 'dependabot',
          alert_number: alertCounter,
          state: 'fixed',
          severity: sev,
          package_name: `demo-pkg-${alertCounter}`,
          cve_id: `DEMO-${alertCounter}`,
          file_path: `package.json`,
          fixed_by: pickWeighted(fixSources, fixWeights),
          opened_at: openedDate.toISOString(),
          resolved_at: dayTimestamp,
          event_timestamp: dayTimestamp,
          jira_key: null,
        });
        eventsGenerated++;
      }

      // Open 0-2 new vulns occasionally
      const newCount = randomInt(0, 2);
      for (let n = 0; n < newCount; n++) {
        const sev = pickWeighted(severities, [1, 2, 3, 2]);
        openCounts[sev]++;
        alertCounter++;

        insertEvent.run({
          alert_type: pickWeighted(['dependabot', 'code_scanning', 'secret_scanning'] as any[], [5, 3, 2]),
          alert_number: alertCounter,
          state: 'open',
          severity: sev,
          package_name: sev === 'critical' ? `vuln-lib-${alertCounter}` : null,
          cve_id: `DEMO-${alertCounter}`,
          file_path: `src/demo-file-${alertCounter}.ts`,
          fixed_by: null,
          opened_at: dayTimestamp,
          resolved_at: null,
          event_timestamp: dayTimestamp,
          jira_key: null,
        });
        eventsGenerated++;
      }

      // Compute running MTTR from all fixed events so far
      const mttrRow = db
        .prepare(
          `SELECT AVG((julianday(resolved_at) - julianday(opened_at)) * 24) as mttr
           FROM vuln_events WHERE state = 'fixed' AND resolved_at IS NOT NULL`
        )
        .get() as { mttr: number | null };

      const totalOpen = Object.values(openCounts).reduce((a, b) => a + b, 0);

      insertSnap.run({
        snapshot_date: dayISO,
        total_open: totalOpen,
        critical_open: openCounts.critical,
        high_open: openCounts.high,
        medium_open: openCounts.medium,
        low_open: openCounts.low,
        fixed_today: fixedToday,
        mttr_hours: mttrRow.mttr,
      });
      snapshotsGenerated++;
    }
  });

  batchInsert();
  return { eventsGenerated, snapshotsGenerated };
}

// ── Query functions ────────────────────────────────────────────────────────

export function getVulnTimeline(days: number = 90): TimelinePoint[] {
  const since = toISODate(daysAgo(days));
  const rows = db
    .prepare(
      `SELECT snapshot_date, total_open, fixed_today
       FROM vuln_snapshots
       WHERE snapshot_date >= ?
       ORDER BY snapshot_date ASC`
    )
    .all(since) as Array<{ snapshot_date: string; total_open: number; fixed_today: number }>;

  return rows.map((r) => ({
    date: r.snapshot_date,
    open: r.total_open,
    fixed: r.fixed_today,
  }));
}

export function getMTTR(): MTTRResult {
  // Overall MTTR
  const overallRow = db
    .prepare(
      `SELECT AVG((julianday(resolved_at) - julianday(opened_at)) * 24) as mttr
       FROM vuln_events
       WHERE state = 'fixed' AND resolved_at IS NOT NULL`
    )
    .get() as { mttr: number | null };

  // By severity
  const sevRows = db
    .prepare(
      `SELECT severity, AVG((julianday(resolved_at) - julianday(opened_at)) * 24) as mttr
       FROM vuln_events
       WHERE state = 'fixed' AND resolved_at IS NOT NULL
       GROUP BY severity`
    )
    .all() as Array<{ severity: string | null; mttr: number | null }>;

  const bySeverity: Record<string, number | null> = {};
  for (const row of sevRows) {
    bySeverity[row.severity ?? 'unknown'] = row.mttr !== null ? Math.round(row.mttr * 10) / 10 : null;
  }

  // Trend: last 30d vs previous 30d
  const last30 = toISODate(daysAgo(30));
  const prev60 = toISODate(daysAgo(60));

  const recentRow = db
    .prepare(
      `SELECT AVG((julianday(resolved_at) - julianday(opened_at)) * 24) as mttr
       FROM vuln_events
       WHERE state = 'fixed' AND resolved_at IS NOT NULL AND resolved_at >= ?`
    )
    .get(last30) as { mttr: number | null };

  const prevRow = db
    .prepare(
      `SELECT AVG((julianday(resolved_at) - julianday(opened_at)) * 24) as mttr
       FROM vuln_events
       WHERE state = 'fixed' AND resolved_at IS NOT NULL
         AND resolved_at >= ? AND resolved_at < ?`
    )
    .get(prev60, last30) as { mttr: number | null };

  let trend: 'improving' | 'worsening' | 'stable' = 'stable';
  if (recentRow.mttr !== null && prevRow.mttr !== null) {
    if (recentRow.mttr < prevRow.mttr * 0.9) trend = 'improving';
    else if (recentRow.mttr > prevRow.mttr * 1.1) trend = 'worsening';
  }

  return {
    overall: overallRow.mttr !== null ? Math.round(overallRow.mttr * 10) / 10 : null,
    bySeverity,
    trend,
    previousPeriod: prevRow.mttr !== null ? Math.round(prevRow.mttr * 10) / 10 : null,
  };
}

export function getFixedVulns(days: number = 30): VulnEvent[] {
  const since = daysAgo(days).toISOString();
  const rows = db
    .prepare(
      `SELECT * FROM vuln_events
       WHERE state = 'fixed' AND event_timestamp >= ?
       ORDER BY event_timestamp DESC`
    )
    .all(since) as Array<Record<string, any>>;

  return rows.map(rowToVulnEvent);
}

export function getOpenByAge(): AgeBucket[] {
  const now = new Date();
  const rows = db
    .prepare(
      `SELECT opened_at FROM vuln_events WHERE state = 'open'`
    )
    .all() as Array<{ opened_at: string }>;

  const buckets: Record<string, number> = { '<7d': 0, '7-30d': 0, '30-90d': 0, '>90d': 0 };
  for (const row of rows) {
    const ageDays = (now.getTime() - new Date(row.opened_at).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays < 7) buckets['<7d']++;
    else if (ageDays < 30) buckets['7-30d']++;
    else if (ageDays < 90) buckets['30-90d']++;
    else buckets['>90d']++;
  }

  return Object.entries(buckets).map(([label, count]) => ({ label, count }));
}

export function getSeverityTrends(
  days: number = 90
): Array<{ date: string; critical: number; high: number; medium: number; low: number }> {
  const since = toISODate(daysAgo(days));
  const rows = db
    .prepare(
      `SELECT snapshot_date, critical_open, high_open, medium_open, low_open
       FROM vuln_snapshots
       WHERE snapshot_date >= ?
       ORDER BY snapshot_date ASC`
    )
    .all(since) as Array<{
    snapshot_date: string;
    critical_open: number;
    high_open: number;
    medium_open: number;
    low_open: number;
  }>;

  return rows.map((r) => ({
    date: r.snapshot_date,
    critical: r.critical_open,
    high: r.high_open,
    medium: r.medium_open,
    low: r.low_open,
  }));
}

export function getRemediationRate(): RemediationRate[] {
  const windows = [30, 60, 90];
  return windows.map((w) => {
    const since = daysAgo(w).toISOString();

    const detected = (
      db
        .prepare(`SELECT COUNT(*) as cnt FROM vuln_events WHERE event_timestamp >= ?`)
        .get(since) as { cnt: number }
    ).cnt;

    const fixed = (
      db
        .prepare(
          `SELECT COUNT(*) as cnt FROM vuln_events
           WHERE state = 'fixed' AND event_timestamp >= ?`
        )
        .get(since) as { cnt: number }
    ).cnt;

    return {
      window: w,
      totalDetected: detected,
      totalFixed: fixed,
      rate: detected > 0 ? Math.round((fixed / detected) * 1000) / 1000 : 0,
    };
  });
}

export function getCopilotImpact(): CopilotImpact {
  const rows = db
    .prepare(
      `SELECT fixed_by, COUNT(*) as cnt
       FROM vuln_events
       WHERE state = 'fixed'
       GROUP BY fixed_by`
    )
    .all() as Array<{ fixed_by: string | null; cnt: number }>;

  let copilotFixed = 0;
  let humanFixed = 0;
  let dependabotFixed = 0;
  let totalFixed = 0;

  for (const row of rows) {
    totalFixed += row.cnt;
    switch (row.fixed_by) {
      case 'copilot':
        copilotFixed = row.cnt;
        break;
      case 'human':
        humanFixed = row.cnt;
        break;
      case 'dependabot-auto':
        dependabotFixed = row.cnt;
        break;
    }
  }

  return {
    totalFixed,
    copilotFixed,
    humanFixed,
    dependabotFixed,
    copilotPercent: totalFixed > 0 ? Math.round((copilotFixed / totalFixed) * 1000) / 10 : 0,
  };
}

export function getTrendSummary(): TrendSummary {
  // Critical reduction vs 90 days ago
  const oldest = db
    .prepare(
      `SELECT critical_open FROM vuln_snapshots ORDER BY snapshot_date ASC LIMIT 1`
    )
    .get() as { critical_open: number } | undefined;

  const latest = db
    .prepare(
      `SELECT total_open, critical_open FROM vuln_snapshots ORDER BY snapshot_date DESC LIMIT 1`
    )
    .get() as { total_open: number; critical_open: number } | undefined;

  const oldCritical = oldest?.critical_open ?? 0;
  const newCritical = latest?.critical_open ?? 0;
  const criticalReduction =
    oldCritical > 0 ? Math.round(((oldCritical - newCritical) / oldCritical) * 1000) / 10 : 0;

  const mttr = getMTTR();
  const impact = getCopilotImpact();

  const fixed30d = (
    db
      .prepare(
        `SELECT COUNT(*) as cnt FROM vuln_events
         WHERE state = 'fixed' AND event_timestamp >= ?`
      )
      .get(daysAgo(30).toISOString()) as { cnt: number }
  ).cnt;

  return {
    criticalReduction,
    mttrHours: mttr.overall,
    mttrTrend: mttr.trend,
    copilotImpact: impact,
    totalOpen: latest?.total_open ?? 0,
    totalFixed30d: fixed30d,
  };
}

// ── Internal helpers ───────────────────────────────────────────────────────

function rowToVulnEvent(row: Record<string, any>): VulnEvent {
  return {
    id: row.id,
    alertType: row.alert_type,
    alertNumber: row.alert_number,
    state: row.state,
    severity: row.severity,
    packageName: row.package_name,
    cveId: row.cve_id,
    filePath: row.file_path,
    fixedBy: row.fixed_by,
    openedAt: row.opened_at,
    resolvedAt: row.resolved_at,
    eventTimestamp: row.event_timestamp,
    jiraKey: row.jira_key,
  };
}

// ── Auto-init on module load ───────────────────────────────────────────────

initDB();
