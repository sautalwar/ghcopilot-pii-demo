import { CVE, JiraTicket, GovernanceSummary, SBOMEntry, TrendsSummary, ZeroDayAlert, PipelineRun } from './api-client';

export class MessageFormatter {
  static severityBadge(severity: string): string {
    const badges: Record<string, string> = {
      critical: '🔴',
      high: '🟠',
      medium: '🟡',
      low: '🟢',
    };
    return badges[severity.toLowerCase()] || '⚪';
  }

  /**
   * Format CVEs as a severity-grouped markdown table with badges.
   * Groups: Critical → High → Medium → Low
   */
  static formatCVETable(cves: CVE[], title: string = 'Vulnerabilities'): string {
    if (!cves.length) {
      return `### ${title}\n\n✅ No vulnerabilities found.`;
    }

    // Group by severity
    const groups: Record<string, CVE[]> = { critical: [], high: [], medium: [], low: [], other: [] };
    for (const cve of cves) {
      const sev = (cve.severity || 'other').toLowerCase();
      (groups[sev] || groups.other).push(cve);
    }

    let md = `### ${title}\n\n`;
    md += `**Total:** ${cves.length} vulnerabilities`;

    // Summary counts
    const counts = Object.entries(groups)
      .filter(([, v]) => v.length > 0)
      .map(([k, v]) => `${this.severityBadge(k)} ${k.toUpperCase()}: ${v.length}`);
    md += ` (${counts.join(' · ')})\n\n`;

    // Table
    md += '| Severity | CVE ID | CVSS | Package | Summary | Fix |\n';
    md += '|----------|--------|------|---------|---------|-----|\n';

    for (const severity of ['critical', 'high', 'medium', 'low', 'other']) {
      for (const c of groups[severity]) {
        const cvss = c.cvssScore != null ? c.cvssScore.toFixed(1) : '—';
        const fix = c.fixedIn || '—';
        md += `| ${this.severityBadge(c.severity)} ${c.severity?.toUpperCase()} | ${c.id} | ${cvss} | ${c.affectedPackage || '—'} | ${c.summary} | ${fix} |\n`;
      }
    }

    return md;
  }

  /**
   * Format Jira tickets as cards with status, assignee, and priority.
   */
  static formatJiraTickets(tickets: JiraTicket[]): string {
    if (!tickets.length) {
      return '### 🎫 Jira Tickets\n\nNo tickets found.';
    }

    let md = `### 🎫 Jira Tickets (${tickets.length})\n\n`;

    for (const t of tickets) {
      const statusIcon = this._jiraStatusIcon(t.status);
      const link = t.url ? `[${t.key}](${t.url})` : t.key;
      md += `---\n`;
      md += `**${link}** ${statusIcon} ${t.status}\n\n`;
      md += `${t.summary}\n\n`;
      md += `> **Priority:** ${this._priorityIcon(t.priority)} ${t.priority}`;
      md += ` · **Assignee:** ${t.assignee || '_Unassigned_'}\n\n`;
    }

    return md;
  }

  static formatJiraCreated(ticket: JiraTicket): string {
    return `### ✅ Jira Ticket Created\n\n` +
      `- **Key:** ${ticket.url ? `[${ticket.key}](${ticket.url})` : ticket.key}\n` +
      `- **Summary:** ${ticket.summary}\n` +
      `- **Status:** ${this._jiraStatusIcon(ticket.status)} ${ticket.status}\n` +
      `- **Priority:** ${this._priorityIcon(ticket.priority)} ${ticket.priority}\n` +
      (ticket.assignee ? `- **Assignee:** ${ticket.assignee}\n` : '');
  }

  /**
   * Format governance summary as a ✅/❌ checklist.
   */
  static formatGovernanceChecklist(summary: GovernanceSummary): string {
    const allPassed = summary.failed === 0;
    const icon = allPassed ? '✅' : '❌';
    let md = `### Governance Summary ${icon}\n\n`;
    md += `**Score:** ${summary.passed}/${summary.totalChecks} checks passed\n\n`;

    if (summary.checks.length) {
      md += '#### Checklist\n\n';
      for (const check of summary.checks) {
        const checkIcon = check.status === 'passed' ? '✅' : '❌';
        md += `- ${checkIcon} **${check.name}** — ${check.message}\n`;
      }
    }

    if (!allPassed) {
      md += `\n> ⚠️ ${summary.failed} check(s) failed. Review and fix before merging.`;
    }

    return md;
  }

  /**
   * Format SBOM as an indented dependency tree.
   */
  static formatSBOMTree(entries: SBOMEntry[]): string {
    if (!entries.length) {
      return '### 📦 Software Bill of Materials\n\nNo dependencies found.';
    }

    const direct = entries.filter(e => e.direct);
    const transitive = entries.filter(e => !e.direct);

    let md = `### 📦 Software Bill of Materials\n\n`;
    md += `**Direct:** ${direct.length} · **Transitive:** ${transitive.length} · **Total:** ${entries.length}\n\n`;

    // Indented tree format
    md += '```\n';
    for (const d of direct) {
      const vulnTag = (d.vulnerabilities?.length || 0) > 0
        ? ` ⚠️ ${d.vulnerabilities!.length} CVE(s)`
        : '';
      md += `├── ${d.name}@${d.version} (${d.license})${vulnTag}\n`;

      // Find transitive deps that might belong to this parent
      const children = transitive.filter(t =>
        t.name.startsWith(d.name) || t.name.includes(d.name.split('/').pop() || '')
      );
      for (let i = 0; i < children.length; i++) {
        const c = children[i];
        const cVulnTag = (c.vulnerabilities?.length || 0) > 0
          ? ` ⚠️ ${c.vulnerabilities!.length} CVE(s)`
          : '';
        const prefix = i === children.length - 1 ? '│   └── ' : '│   ├── ';
        md += `${prefix}${c.name}@${c.version} (${c.license})${cVulnTag}\n`;
      }
    }
    md += '```\n';

    // License summary
    const licenses = new Map<string, number>();
    for (const e of entries) {
      licenses.set(e.license, (licenses.get(e.license) || 0) + 1);
    }
    md += '\n#### License Distribution\n\n';
    md += '| License | Count |\n|---------|-------|\n';
    for (const [lic, count] of [...licenses.entries()].sort((a, b) => b[1] - a[1])) {
      md += `| ${lic} | ${count} |\n`;
    }

    return md;
  }

  /**
   * Format trends summary with emoji trend arrows and stats.
   */
  static formatTrendsSummary(data: TrendsSummary): string {
    const trendIcon = data.trend === 'improving' ? '📉' : data.trend === 'degrading' ? '📈' : '➡️';
    const trendWord = data.trend === 'improving' ? 'Improving' : data.trend === 'degrading' ? 'Degrading' : 'Stable';

    let md = `### Vulnerability Trends ${trendIcon}\n\n`;
    md += `| Metric | Value |\n|--------|-------|\n`;
    md += `| Total Open | **${data.totalVulnerabilities}** |\n`;
    md += `| ${this.severityBadge('critical')} Critical | ${data.criticalCount} |\n`;
    md += `| ${this.severityBadge('high')} High | ${data.highCount} |\n`;
    md += `| ${this.severityBadge('medium')} Medium | ${data.mediumCount} |\n`;
    md += `| ${this.severityBadge('low')} Low | ${data.lowCount} |\n`;
    md += `| Trend | ${trendIcon} ${trendWord} |\n`;
    md += `| Period | ${data.timeRange} |\n`;

    // Severity distribution bar (text-based)
    const total = data.criticalCount + data.highCount + data.mediumCount + data.lowCount;
    if (total > 0) {
      md += '\n#### Distribution\n\n```\n';
      md += this._asciiBar('CRIT', data.criticalCount, total);
      md += this._asciiBar('HIGH', data.highCount, total);
      md += this._asciiBar('MED ', data.mediumCount, total);
      md += this._asciiBar('LOW ', data.lowCount, total);
      md += '```\n';
    }

    return md;
  }

  /**
   * Format zero-day alerts, highlighting CISA KEV items.
   */
  static formatZeroDayAlerts(alerts: ZeroDayAlert[]): string {
    if (!alerts.length) {
      return '### 🚨 Zero-Day Alerts\n\n✅ No active zero-day threats detected.';
    }

    let md = `### 🚨 Zero-Day Alerts (${alerts.length} active)\n\n`;

    for (const alert of alerts) {
      const isKEV = alert.cisaKEV === true;
      const kevBadge = isKEV ? ' 🏛️ **CISA KEV**' : '';

      md += `---\n`;
      md += `#### ${this.severityBadge(alert.severity)} ${alert.cveId}${kevBadge}\n\n`;
      md += `${alert.description}\n\n`;
      md += `- **Severity:** ${alert.severity.toUpperCase()}\n`;
      md += `- **Discovered:** ${alert.discoveredAt}\n`;
      md += `- **Affected Packages:** ${alert.affectedPackages.join(', ')}\n`;
      if (isKEV) {
        md += `- ⚠️ **This vulnerability is in the CISA Known Exploited Vulnerabilities catalog.** Immediate remediation required.\n`;
      }
      md += '\n';
    }

    return md;
  }

  /**
   * Format pipeline/remediation run status with step indicators.
   */
  static formatPipelineStatus(run: PipelineRun): string {
    let md = `### 🔧 Remediation Pipeline — ${run.status}\n\n`;
    md += `**Run ID:** ${run.id}\n`;
    md += `**Started:** ${run.startedAt || 'pending'}\n\n`;

    if (run.steps && run.steps.length > 0) {
      md += '#### Steps\n\n';
      for (const step of run.steps) {
        let icon: string;
        switch (step.status) {
          case 'completed': icon = '✅'; break;
          case 'running': icon = '🔄'; break;
          case 'pending': icon = '⏳'; break;
          case 'failed': icon = '❌'; break;
          default: icon = '⏳';
        }
        md += `${icon} **${step.name}**`;
        if (step.duration) { md += ` (${step.duration})`; }
        if (step.message) { md += ` — ${step.message}`; }
        md += '\n';
      }
    }

    if (run.prUrl) {
      md += `\n🔗 **Pull Request:** [View PR](${run.prUrl})\n`;
    }

    return md;
  }

  static formatError(command: string, error: string): string {
    return `### ❌ Error — ${command}\n\n\`\`\`\n${error}\n\`\`\`\n\nPlease check that the GHAS API server is running at the configured URL.`;
  }

  // --- Private helpers ---

  private static _jiraStatusIcon(status: string): string {
    const s = (status || '').toLowerCase();
    if (['done', 'resolved', 'closed'].includes(s)) { return '✅'; }
    if (['in progress', 'in review'].includes(s)) { return '🔄'; }
    if (s === 'blocked') { return '🚫'; }
    return '🔵';
  }

  private static _priorityIcon(priority: string): string {
    switch ((priority || '').toLowerCase()) {
      case 'critical':
      case 'highest': return '🔴';
      case 'high': return '🟠';
      case 'medium': return '🟡';
      case 'low':
      case 'lowest': return '🟢';
      default: return '⚪';
    }
  }

  private static _asciiBar(label: string, count: number, total: number): string {
    const maxWidth = 25;
    const width = total > 0 ? Math.max(count > 0 ? 1 : 0, Math.round((count / total) * maxWidth)) : 0;
    const bar = '█'.repeat(width) + '░'.repeat(maxWidth - width);
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    return `${label} ${bar} ${count} (${pct}%)\n`;
  }
}
