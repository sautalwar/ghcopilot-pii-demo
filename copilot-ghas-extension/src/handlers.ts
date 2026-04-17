import { GHASApiClient, CVE } from './api-client';
import { MessageFormatter } from './message-formatter';

const client = new GHASApiClient();

export interface HandlerResult {
  body: string;
}

export async function handleScan(): Promise<HandlerResult> {
  const result = await client.getCVEsAffectingRepo();
  if (result.success && result.data) {
    return { body: MessageFormatter.formatCVETable(result.data, 'Scan Results — Vulnerabilities Affecting This Repo') };
  }
  return { body: MessageFormatter.formatError('/scan', result.error || 'Unknown error') };
}

export async function handleCVEs(userMessage?: string): Promise<HandlerResult> {
  const result = await client.getLatestCVEs();
  if (result.success && result.data) {
    let cves = result.data;

    // Optional severity filter from user message, e.g. "/cves critical" or "/cves severity:high"
    if (userMessage) {
      const severityFilter = extractSeverityFilter(userMessage);
      if (severityFilter) {
        cves = cves.filter(c => (c.severity || '').toLowerCase() === severityFilter);
      }
    }

    const title = 'Latest CVEs' + (userMessage ? extractFilterLabel(userMessage) : '');
    return { body: MessageFormatter.formatCVETable(cves, title) };
  }
  return { body: MessageFormatter.formatError('/cves', result.error || 'Unknown error') };
}

export async function handleJira(params: {
  action?: string;
  query?: string;
  summary?: string;
  description?: string;
  priority?: string;
  cveId?: string;
}): Promise<HandlerResult> {
  // Detect create intent from action param or keywords in query
  const isCreate = params.action === 'create' ||
    (params.query && /\b(create|new|open)\b/i.test(params.query));

  if (isCreate && (params.summary || params.query)) {
    const summary = params.summary || params.query || 'New security ticket';
    const result = await client.createJiraTicket({
      summary,
      description: params.description || '',
      priority: params.priority || 'High',
      cveId: params.cveId,
    });
    if (result.success && result.data) {
      return { body: MessageFormatter.formatJiraCreated(result.data) };
    }
    return { body: MessageFormatter.formatError('/jira create', result.error || 'Unknown error') };
  }

  // Default: search/list tickets
  const result = await client.searchJiraTickets(params.query);
  if (result.success && result.data) {
    return { body: MessageFormatter.formatJiraTickets(result.data) };
  }
  return { body: MessageFormatter.formatError('/jira', result.error || 'Unknown error') };
}

export async function handleGovernance(): Promise<HandlerResult> {
  const result = await client.getGovernanceSummary();
  if (result.success && result.data) {
    return { body: MessageFormatter.formatGovernanceChecklist(result.data) };
  }
  return { body: MessageFormatter.formatError('/governance', result.error || 'Unknown error') };
}

export async function handleSBOM(): Promise<HandlerResult> {
  const result = await client.getSBOM();
  if (result.success && result.data) {
    return { body: MessageFormatter.formatSBOMTree(result.data) };
  }
  return { body: MessageFormatter.formatError('/sbom', result.error || 'Unknown error') };
}

export async function handleZeroDay(): Promise<HandlerResult> {
  const result = await client.getZeroDayAlerts();
  if (result.success && result.data) {
    return { body: MessageFormatter.formatZeroDayAlerts(result.data) };
  }
  return { body: MessageFormatter.formatError('/zeroday', result.error || 'Unknown error') };
}

export async function handleTrends(): Promise<HandlerResult> {
  const result = await client.getTrendsSummary();
  if (result.success && result.data) {
    return { body: MessageFormatter.formatTrendsSummary(result.data) };
  }
  return { body: MessageFormatter.formatError('/trends', result.error || 'Unknown error') };
}

export async function handleRemediate(params: {
  cveId?: string;
  packageName?: string;
  query?: string;
}): Promise<HandlerResult> {
  const cveId = params.cveId || params.query;
  if (!cveId) {
    return {
      body: '### 🔧 Remediation\n\nPlease specify a CVE ID or package to remediate.\n\n' +
        '**Usage:** `/remediate CVE-2024-1234` or `/remediate cveId=CVE-2024-1234`',
    };
  }

  const result = await client.startRemediation({
    cveId: cveId,
    packageName: params.packageName,
  });

  if (result.success && result.data) {
    return { body: MessageFormatter.formatPipelineStatus(result.data) };
  }
  return { body: MessageFormatter.formatError('/remediate', result.error || 'Unknown error') };
}

// --- Helpers ---

function extractSeverityFilter(message: string): string | null {
  const severities = ['critical', 'high', 'medium', 'low'];
  const lower = message.toLowerCase();

  // Match "severity:critical" or "severity=high"
  const match = lower.match(/severity[=:](\w+)/);
  if (match && severities.includes(match[1])) {
    return match[1];
  }

  // Match standalone severity word after the command
  for (const sev of severities) {
    if (lower.includes(sev)) {
      return sev;
    }
  }

  return null;
}

function extractFilterLabel(message: string): string {
  const filter = extractSeverityFilter(message);
  return filter ? ` (${filter.toUpperCase()} only)` : '';
}
