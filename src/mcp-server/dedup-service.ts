import { IJiraClient, JiraIssue } from './jira-client';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface GHASFinding {
  type: 'secret_scanning' | 'dependabot' | 'code_scanning';
  ruleId?: string;
  cveId?: string;
  packageName?: string;
  filePath?: string;
  severity?: string;
  title?: string;
}

export interface DedupResult {
  found: boolean;
  issueKey: string | null;
  confidence: number;
  existingIssue: JiraIssue | null;
}

// ── JQL Builder ─────────────────────────────────────────────────────────────

export function buildJQL(finding: GHASFinding): string {
  switch (finding.type) {
    case 'secret_scanning': {
      const filePart = finding.filePath
        ? ` AND description ~ "${finding.filePath}"`
        : '';
      return `summary ~ "secret"${filePart}`;
    }

    case 'dependabot': {
      const parts: string[] = [];
      if (finding.cveId) {
        parts.push(`summary ~ "${finding.cveId}"`);
      }
      if (finding.packageName) {
        parts.push(`(summary ~ "${finding.packageName}" AND description ~ "vulnerability")`);
      }
      return parts.length > 0 ? parts.join(' OR ') : 'summary ~ "dependabot"';
    }

    case 'code_scanning': {
      const rulePart = finding.ruleId
        ? `summary ~ "${finding.ruleId}"`
        : 'summary ~ "code scanning"';
      const filePart = finding.filePath
        ? ` AND description ~ "${finding.filePath}"`
        : '';
      return `${rulePart}${filePart}`;
    }

    default:
      return 'summary ~ "security"';
  }
}

// ── Deduplication Check ─────────────────────────────────────────────────────

export async function checkForDuplicate(
  finding: GHASFinding,
  jiraClient: IJiraClient
): Promise<DedupResult> {
  const jql = buildJQL(finding);
  const result = await jiraClient.searchIssues(jql);

  if (result.total === 0) {
    return { found: false, issueKey: null, confidence: 0, existingIssue: null };
  }

  let bestMatch: JiraIssue | null = null;
  let bestConfidence = 0;

  for (const issue of result.issues) {
    const confidence = computeConfidence(finding, issue);
    if (confidence > bestConfidence) {
      bestConfidence = confidence;
      bestMatch = issue;
    }
  }

  if (bestConfidence > 0.5 && bestMatch) {
    return {
      found: true,
      issueKey: bestMatch.key,
      confidence: bestConfidence,
      existingIssue: bestMatch,
    };
  }

  return { found: false, issueKey: null, confidence: bestConfidence, existingIssue: null };
}

// ── Confidence Scoring ──────────────────────────────────────────────────────

function computeConfidence(finding: GHASFinding, issue: JiraIssue): number {
  let confidence = 0;
  const summaryLower = issue.summary.toLowerCase();
  const descLower = issue.description.toLowerCase();

  // Exact CVE ID match in summary → highest confidence
  if (finding.cveId && summaryLower.includes(finding.cveId.toLowerCase())) {
    return 1.0;
  }

  // Package name + vulnerability context
  if (finding.packageName) {
    const pkgLower = finding.packageName.toLowerCase();
    if (summaryLower.includes(pkgLower) || descLower.includes(pkgLower)) {
      confidence = Math.max(confidence, 0.8);
    }
  }

  // Rule ID match
  if (finding.ruleId) {
    const ruleLower = finding.ruleId.toLowerCase();
    if (summaryLower.includes(ruleLower) || descLower.includes(ruleLower)) {
      confidence = Math.max(confidence, 0.8);
    }
  }

  // File path match
  if (finding.filePath) {
    const pathLower = finding.filePath.toLowerCase();
    if (descLower.includes(pathLower) || summaryLower.includes(pathLower)) {
      confidence = Math.max(confidence, 0.6);
    }
  }

  return confidence;
}
