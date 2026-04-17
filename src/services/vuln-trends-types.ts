export interface VulnEvent {
  id?: number;
  alertType: 'dependabot' | 'code_scanning' | 'secret_scanning';
  alertNumber: number;
  state: 'open' | 'fixed' | 'dismissed' | 'reopened';
  severity: 'critical' | 'high' | 'medium' | 'low' | null;
  packageName: string | null;
  cveId: string | null;
  filePath: string | null;
  fixedBy: 'copilot' | 'human' | 'dependabot-auto' | null;
  openedAt: string;          // ISO 8601
  resolvedAt: string | null; // ISO 8601
  eventTimestamp: string;    // when recorded
  jiraKey: string | null;
}

export interface VulnSnapshot {
  id?: number;
  snapshotDate: string;      // ISO 8601 date
  totalOpen: number;
  criticalOpen: number;
  highOpen: number;
  mediumOpen: number;
  lowOpen: number;
  fixedToday: number;
  mttrHours: number | null;
}

export interface TimelinePoint {
  date: string;
  open: number;
  fixed: number;
}

export interface MTTRResult {
  overall: number | null;        // hours
  bySeverity: Record<string, number | null>;
  trend: 'improving' | 'worsening' | 'stable';
  previousPeriod: number | null; // for comparison
}

export interface RemediationRate {
  window: number;        // days
  totalDetected: number;
  totalFixed: number;
  rate: number;          // 0.0-1.0
}

export interface CopilotImpact {
  totalFixed: number;
  copilotFixed: number;
  humanFixed: number;
  dependabotFixed: number;
  copilotPercent: number;
}

export interface AgeBucket {
  label: string;
  count: number;
}

export interface TrendSummary {
  criticalReduction: number;    // % change vs 90 days ago
  mttrHours: number | null;
  mttrTrend: string;
  copilotImpact: CopilotImpact;
  totalOpen: number;
  totalFixed30d: number;
}
