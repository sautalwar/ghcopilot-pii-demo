// ---------------------------------------------------------------------------
// Pipeline State Types — 12-step vulnerability remediation pipeline
// ---------------------------------------------------------------------------

// ── Step & Status Enums ─────────────────────────────────────────────────────

export type PipelineStep =
  | 'detect'
  | 'triage'
  | 'ticket'
  | 'assign'
  | 'monitor'
  | 'review'
  | 'approve'
  | 'merge-fb'
  | 'gate'
  | 'merge-main'
  | 'verify'
  | 'report';

export type PipelineStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type StepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'waiting';

export type VulnSource =
  | 'dependabot'
  | 'code_scanning'
  | 'secret_scanning'
  | 'manual'
  | 'cve_feed';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type FixedBy = 'copilot' | 'human' | 'dependabot-auto' | 'pipeline';

// ── Ordered Steps Constant ──────────────────────────────────────────────────

export const PIPELINE_STEPS: readonly PipelineStep[] = [
  'detect',
  'triage',
  'ticket',
  'assign',
  'monitor',
  'review',
  'approve',
  'merge-fb',
  'gate',
  'merge-main',
  'verify',
  'report',
] as const;

// ── Check / Gate Result Types ───────────────────────────────────────────────

export interface CheckResult {
  name: string;
  status: 'passed' | 'failed' | 'pending';
  details?: string;
}

export interface GateCheck {
  name: string;
  status: 'passed' | 'failed' | 'pending';
  details?: string;
}

// ── Step-Specific Output Types ──────────────────────────────────────────────

export interface DetectOutput {
  alertType: string;
  alertNumber: number;
  description: string;
}

export interface TriageOutput {
  isDuplicate: boolean;
  existingJiraKey?: string;
  confidence: number;
}

export interface TicketOutput {
  jiraKey: string;
  jiraUrl: string;
  githubIssueNumber: number;
  githubIssueUrl: string;
}

export interface AssignOutput {
  assignee: string;
  label: string;
}

export interface MonitorOutput {
  branchName: string;
  prNumber: number;
  prUrl: string;
  isDraft: boolean;
}

export interface ReviewOutput {
  checksPassedCount: number;
  checksFailedCount: number;
  checkDetails: CheckResult[];
}

export interface ApproveOutput {
  approver: string;
  reviewId: number;
}

export interface MergeFbOutput {
  mergeCommitSha: string;
  targetBranch: string;
}

export interface GateOutput {
  gateResults: GateCheck[];
}

export interface MergeMainOutput {
  mergeCommitSha: string;
  mergedBy: string;
}

export interface VerifyOutput {
  alertResolved: boolean;
  jiraClosed: boolean;
}

export interface ReportOutput {
  mttrHours: number;
  trendUpdated: boolean;
}

/** Discriminated union of all step outputs keyed by step name. */
export type StepOutputMap = {
  detect: DetectOutput;
  triage: TriageOutput;
  ticket: TicketOutput;
  assign: AssignOutput;
  monitor: MonitorOutput;
  review: ReviewOutput;
  approve: ApproveOutput;
  'merge-fb': MergeFbOutput;
  gate: GateOutput;
  'merge-main': MergeMainOutput;
  verify: VerifyOutput;
  report: ReportOutput;
};

export type StepOutput = StepOutputMap[PipelineStep];

// ── Step Record ─────────────────────────────────────────────────────────────

export interface StepRecord {
  step: PipelineStep;
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  /** Duration in milliseconds */
  duration?: number;
  output?: StepOutput;
  error?: string;
  retries: number;
}

// ── Pipeline Run ────────────────────────────────────────────────────────────

export interface PipelineRun {
  id: string;
  vulnId: string;
  vulnSource: VulnSource;
  severity: Severity;
  packageName?: string;
  filePath?: string;
  status: PipelineStatus;
  currentStep: PipelineStep;
  steps: StepRecord[];
  jiraKey?: string;
  githubIssueNumber?: number;
  githubPrNumber?: number;
  branchName?: string;
  fixedBy?: FixedBy;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  retryCount: number;
  metadata: Record<string, unknown>;
}

// ── Pipeline Config ─────────────────────────────────────────────────────────

export interface PipelineConfig {
  maxRetries: number;
  retryDelayMs: number;
  /** How long to wait for Copilot to create a PR (ms) */
  monitorTimeoutMs: number;
  autoMergeEnabled: boolean;
  gateChecks: string[];
  notifyOnFailure: boolean;
  /** After this many retries, escalate to human review */
  escalateAfterRetries: number;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  maxRetries: 3,
  retryDelayMs: 30_000,
  monitorTimeoutMs: 600_000,
  autoMergeEnabled: false,
  gateChecks: ['unit-tests', 'codeql', 'governance', 'license-compliance'],
  notifyOnFailure: true,
  escalateAfterRetries: 2,
};

// ── Valid Transitions ───────────────────────────────────────────────────────

/**
 * Map of each step to its valid next steps.
 * Forward transitions follow the pipeline order.
 * Backward transitions support retries (step can retry itself).
 * Skip paths allow jumping past a step when preconditions are already met.
 */
export const VALID_TRANSITIONS: Record<PipelineStep, PipelineStep[]> = {
  detect:      ['triage'],
  triage:      ['ticket', 'triage'],          // retry self; always proceeds to ticket (dedup just tags)
  ticket:      ['assign', 'ticket'],          // retry self
  assign:      ['monitor', 'assign'],         // retry self
  monitor:     ['review', 'monitor'],         // retry/poll self
  review:      ['approve', 'assign', 'review'], // fail → reassign; retry self
  approve:     ['merge-fb', 'review', 'approve'], // reject → back to review; retry self
  'merge-fb':  ['gate', 'merge-fb'],          // retry self
  gate:        ['merge-main', 'review', 'gate'], // gate fail → back to review; retry self
  'merge-main':['verify', 'merge-main'],      // retry self
  verify:      ['report', 'verify'],          // retry self
  report:      ['report'],                    // terminal; retry self only
};

// ── Pipeline Events ─────────────────────────────────────────────────────────

export type PipelineEventType =
  | 'step_started'
  | 'step_completed'
  | 'step_failed'
  | 'pipeline_completed'
  | 'pipeline_failed'
  | 'retry';

export interface PipelineEvent {
  type: PipelineEventType;
  pipelineId: string;
  step?: PipelineStep;
  timestamp: string;
  data?: Record<string, unknown>;
}

// ── Dashboard Summary ───────────────────────────────────────────────────────

export interface PipelineSummary {
  totalRuns: number;
  active: number;
  completed: number;
  failed: number;
  averageMttrHours: number;
  /** Fraction of fixes attributed to Copilot (0–1) */
  copilotFixRate: number;
  recentRuns: PipelineRun[];
}

// ── Type Guards ─────────────────────────────────────────────────────────────

const PIPELINE_STEP_SET: ReadonlySet<string> = new Set(PIPELINE_STEPS);

export function isPipelineStep(value: unknown): value is PipelineStep {
  return typeof value === 'string' && PIPELINE_STEP_SET.has(value);
}

export function isValidTransition(
  from: PipelineStep,
  to: PipelineStep,
): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}
