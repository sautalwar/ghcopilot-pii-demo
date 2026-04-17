import * as vscode from 'vscode';
import { GHASApiClient, CVE, TrendsSummary, JiraTicket } from './api-client';

export class GHASSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ghas-vulnerabilities';

  private _view?: vscode.WebviewView;
  private _client: GHASApiClient;

  constructor(private readonly _extensionUri: vscode.Uri) {
    this._client = new GHASApiClient();
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtml();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'refreshCves':
          await this._sendCveData();
          break;
        case 'refreshTrends':
          await this._sendTrendsData();
          break;
        case 'refreshJira':
          await this._sendJiraData();
          break;
        case 'refreshData':
          await Promise.all([
            this._sendCveData(),
            this._sendTrendsData(),
            this._sendJiraData(),
          ]);
          break;
        case 'createTicket': {
          const cve = message.cve as CVE | undefined;
          if (cve) {
            const result = await this._client.createJiraTicket({
              summary: `[${cve.severity?.toUpperCase()}] ${cve.id} — ${cve.affectedPackage || 'unknown package'}`,
              description: `${cve.summary}\n\nCVSS Score: ${cve.cvssScore ?? 'N/A'}\nAffected: ${cve.affectedPackage || 'N/A'} ${cve.affectedVersions || ''}\nFix: ${cve.fixedIn || 'No fix available yet'}`,
              priority: cve.severity === 'critical' || cve.severity === 'high' ? 'High' : 'Medium',
              cveId: cve.id,
            });
            if (result.success && result.data) {
              vscode.window.showInformationMessage(`Jira ticket created: ${result.data.key}`);
              await this._sendJiraData();
            } else {
              vscode.window.showErrorMessage(`Failed to create ticket: ${result.error || 'Unknown error'}`);
            }
          } else {
            vscode.commands.executeCommand('ghas.createJiraTicket');
          }
          break;
        }
        case 'openCVE': {
          const cveId = message.cveId as string;
          if (cveId) {
            const nvdUrl = `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cveId)}`;
            vscode.env.openExternal(vscode.Uri.parse(nvdUrl));
          }
          break;
        }
        case 'openJiraTicket': {
          const ticketUrl = message.url as string;
          if (ticketUrl) {
            vscode.env.openExternal(vscode.Uri.parse(ticketUrl));
          }
          break;
        }
      }
    });

    // Initial data load
    this._sendCveData();
  }

  private async _sendCveData(): Promise<void> {
    const result = await this._client.getCVEsAffectingRepo();
    this._view?.webview.postMessage({
      type: 'cveData',
      data: result.success ? result.data : [],
      error: result.error,
    });
  }

  private async _sendTrendsData(): Promise<void> {
    const result = await this._client.getTrendsSummary();
    this._view?.webview.postMessage({
      type: 'trendsData',
      data: result.success ? result.data : null,
      error: result.error,
    });
  }

  private async _sendJiraData(): Promise<void> {
    const result = await this._client.getJiraTickets();
    this._view?.webview.postMessage({
      type: 'jiraData',
      data: result.success ? result.data : [],
      error: result.error,
    });
  }

  private _getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      padding: 0;
      margin: 0;
    }

    /* ── Tabs ── */
    .tabs {
      display: flex;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBarSectionHeader-background, transparent);
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .tab {
      flex: 1;
      padding: 8px 4px;
      cursor: pointer;
      border: none;
      background: none;
      color: var(--vscode-foreground);
      opacity: 0.6;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      transition: opacity 0.15s;
    }
    .tab:hover { opacity: 0.85; }
    .tab.active {
      opacity: 1;
      border-bottom: 2px solid var(--vscode-focusBorder);
    }
    .tab-content { display: none; padding: 8px; }
    .tab-content.active { display: block; }

    /* ── Toolbar ── */
    .toolbar {
      display: flex;
      gap: 4px;
      margin-bottom: 8px;
    }
    .toolbar-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 4px 8px;
      cursor: pointer;
      font-size: 11px;
      border-radius: 2px;
      transition: background 0.15s;
    }
    .toolbar-btn:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .toolbar-btn.secondary {
      background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.08));
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    }

    /* ── CVE Cards ── */
    .cve-card {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 10px;
      margin-bottom: 8px;
      border-left: 3px solid var(--vscode-panel-border);
    }
    .cve-card.sev-critical { border-left-color: #f44336; }
    .cve-card.sev-high { border-left-color: #ff9800; }
    .cve-card.sev-medium { border-left-color: #ffc107; }
    .cve-card.sev-low { border-left-color: #4caf50; }

    .cve-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    .cve-id {
      font-weight: bold;
      font-size: 12px;
      cursor: pointer;
      color: var(--vscode-textLink-foreground);
    }
    .cve-id:hover { text-decoration: underline; }

    .severity-badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: bold;
      color: #fff;
    }
    .severity-badge.critical { background: #f44336; }
    .severity-badge.high { background: #ff9800; }
    .severity-badge.medium { background: #ffc107; color: #333; }
    .severity-badge.low { background: #4caf50; }
    .severity-badge.unknown { background: #757575; }

    .cvss-score {
      font-size: 10px;
      font-weight: bold;
      opacity: 0.8;
      margin-left: 4px;
    }
    .cve-desc {
      font-size: 11px;
      opacity: 0.85;
      margin: 4px 0;
      line-height: 1.4;
    }
    .cve-meta {
      font-size: 10px;
      opacity: 0.6;
      margin-top: 4px;
    }
    .cve-actions {
      display: flex;
      gap: 4px;
      margin-top: 6px;
    }
    .cve-action-btn {
      background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.08));
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      border: none;
      padding: 2px 8px;
      cursor: pointer;
      font-size: 10px;
      border-radius: 2px;
    }
    .cve-action-btn.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    /* ── Trends ── */
    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 12px;
    }
    .stat-card {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 10px;
      text-align: center;
    }
    .stat-value {
      font-size: 22px;
      font-weight: bold;
      line-height: 1.2;
    }
    .stat-label {
      font-size: 10px;
      opacity: 0.6;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .stat-value.critical { color: #f44336; }
    .stat-value.resolved { color: #4caf50; }
    .stat-value.mttr { color: #2196f3; }

    .mini-chart {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 10px;
      margin-bottom: 8px;
      font-family: monospace;
      font-size: 10px;
      line-height: 1.2;
      white-space: pre;
    }
    .chart-title {
      font-family: var(--vscode-font-family);
      font-weight: bold;
      font-size: 11px;
      margin-bottom: 6px;
    }
    .trend-arrow {
      font-size: 14px;
      margin-left: 4px;
    }

    /* ── Jira Tickets ── */
    .jira-card {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 10px;
      margin-bottom: 8px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .jira-card:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .jira-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    .jira-key {
      font-weight: bold;
      font-size: 12px;
      color: var(--vscode-textLink-foreground);
    }
    .status-badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
    }
    .status-badge.open, .status-badge.to-do { background: #1976d2; color: #fff; }
    .status-badge.in-progress { background: #f9a825; color: #333; }
    .status-badge.done, .status-badge.resolved, .status-badge.closed { background: #4caf50; color: #fff; }
    .status-badge.blocked { background: #f44336; color: #fff; }
    .jira-summary { font-size: 11px; opacity: 0.85; }
    .jira-meta {
      font-size: 10px;
      opacity: 0.6;
      margin-top: 4px;
      display: flex;
      gap: 8px;
    }

    .empty-state {
      opacity: 0.5;
      text-align: center;
      padding: 24px 8px;
      font-size: 12px;
    }
    .error-state {
      color: var(--vscode-errorForeground);
      text-align: center;
      padding: 12px;
      font-size: 11px;
    }
    .loading { opacity: 0.5; }
    .count-badge {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 10px;
      padding: 0 6px;
      font-size: 10px;
      margin-left: 4px;
    }
  </style>
</head>
<body>
  <div class="tabs">
    <button class="tab active" data-tab="cves">🛡️ CVE Feed</button>
    <button class="tab" data-tab="trends">📊 Trends</button>
    <button class="tab" data-tab="jira">🎫 Jira</button>
  </div>

  <!-- CVE Feed Tab -->
  <div id="cves" class="tab-content active">
    <div class="toolbar">
      <button class="toolbar-btn" id="refreshCves">↻ Refresh</button>
      <button class="toolbar-btn secondary" id="refreshAll">↻ Refresh All</button>
    </div>
    <div id="cveList"><div class="empty-state loading">Loading CVE data...</div></div>
  </div>

  <!-- Trends Tab -->
  <div id="trends" class="tab-content">
    <div class="toolbar">
      <button class="toolbar-btn" id="refreshTrends">↻ Refresh</button>
    </div>
    <div id="trendsContent"><div class="empty-state">Click refresh to load trends</div></div>
  </div>

  <!-- Jira Tab -->
  <div id="jira" class="tab-content">
    <div class="toolbar">
      <button class="toolbar-btn" id="refreshJira">↻ Refresh</button>
      <button class="toolbar-btn secondary" id="createTicketBtn">+ New Ticket</button>
    </div>
    <div id="jiraList"><div class="empty-state">Click refresh to load Jira tickets</div></div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    // ── Tab switching ──
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        const target = document.getElementById(tab.dataset.tab);
        if (target) { target.classList.add('active'); }
      });
    });

    // ── Refresh buttons ──
    document.getElementById('refreshCves').addEventListener('click', () => {
      document.getElementById('cveList').innerHTML = '<div class="empty-state loading">Loading...</div>';
      vscode.postMessage({ command: 'refreshCves' });
    });
    document.getElementById('refreshTrends').addEventListener('click', () => {
      document.getElementById('trendsContent').innerHTML = '<div class="empty-state loading">Loading...</div>';
      vscode.postMessage({ command: 'refreshTrends' });
    });
    document.getElementById('refreshJira').addEventListener('click', () => {
      document.getElementById('jiraList').innerHTML = '<div class="empty-state loading">Loading...</div>';
      vscode.postMessage({ command: 'refreshJira' });
    });
    document.getElementById('refreshAll').addEventListener('click', () => {
      vscode.postMessage({ command: 'refreshData' });
    });
    document.getElementById('createTicketBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'createTicket' });
    });

    // ── Message handler ──
    window.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.type) {
        case 'cveData':
          msg.error ? renderError('cveList', msg.error) : renderCves(msg.data || []);
          break;
        case 'trendsData':
          msg.error ? renderError('trendsContent', msg.error) : renderTrends(msg.data);
          break;
        case 'jiraData':
          msg.error ? renderError('jiraList', msg.error) : renderJira(msg.data || []);
          break;
      }
    });

    function renderError(elementId, error) {
      document.getElementById(elementId).innerHTML =
        '<div class="error-state">⚠️ ' + escapeHtml(error) + '</div>';
    }

    function escapeHtml(str) {
      if (!str) return '';
      return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // ── CVE Feed Rendering ──
    function renderCves(cves) {
      const el = document.getElementById('cveList');
      if (!cves.length) {
        el.innerHTML = '<div class="empty-state">✅ No CVEs found affecting this repo</div>';
        return;
      }

      // Sort: critical first, then high, medium, low
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      cves.sort((a, b) => (order[a.severity?.toLowerCase()] ?? 4) - (order[b.severity?.toLowerCase()] ?? 4));

      el.innerHTML = cves.map((c, i) => {
        const sev = (c.severity || 'unknown').toLowerCase();
        const cvss = c.cvssScore != null ? c.cvssScore.toFixed(1) : '—';
        return '<div class="cve-card sev-' + sev + '">' +
          '<div class="cve-header">' +
            '<span class="cve-id" data-cveid="' + escapeHtml(c.id) + '">' + escapeHtml(c.id) + '</span>' +
            '<span>' +
              '<span class="severity-badge ' + sev + '">' + sev.toUpperCase() + '</span>' +
              '<span class="cvss-score">CVSS ' + cvss + '</span>' +
            '</span>' +
          '</div>' +
          '<div class="cve-desc">' + escapeHtml(c.summary || '') + '</div>' +
          (c.affectedPackage ? '<div class="cve-meta">📦 ' + escapeHtml(c.affectedPackage) +
            (c.affectedVersions ? ' ' + escapeHtml(c.affectedVersions) : '') +
            (c.fixedIn ? ' → Fix: ' + escapeHtml(c.fixedIn) : '') +
          '</div>' : '') +
          '<div class="cve-actions">' +
            '<button class="cve-action-btn primary" data-create="' + i + '">🎫 Create Ticket</button>' +
            '<button class="cve-action-btn" data-open="' + escapeHtml(c.id) + '">🔗 View in NVD</button>' +
          '</div>' +
        '</div>';
      }).join('');

      // Bind CVE ID click → open in NVD
      el.querySelectorAll('.cve-id').forEach(link => {
        link.addEventListener('click', () => {
          vscode.postMessage({ command: 'openCVE', cveId: link.dataset.cveid });
        });
      });

      // Bind "Create Ticket" buttons
      el.querySelectorAll('[data-create]').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.create, 10);
          vscode.postMessage({ command: 'createTicket', cve: cves[idx] });
        });
      });

      // Bind "View in NVD" buttons
      el.querySelectorAll('[data-open]').forEach(btn => {
        btn.addEventListener('click', () => {
          vscode.postMessage({ command: 'openCVE', cveId: btn.dataset.open });
        });
      });
    }

    // ── Trends Rendering ──
    function renderTrends(data) {
      const el = document.getElementById('trendsContent');
      if (!data) {
        el.innerHTML = '<div class="empty-state">No trend data available</div>';
        return;
      }

      const trendArrow = data.trend === 'improving' ? '📉' : data.trend === 'degrading' ? '📈' : '➡️';
      const resolvedThisWeek = data.resolvedThisWeek || 0;
      const mttr = data.mttrHours ? (data.mttrHours < 24 ? data.mttrHours + 'h' : Math.round(data.mttrHours / 24) + 'd') : '—';

      // Stats grid
      let html = '<div class="stats-grid">' +
        '<div class="stat-card"><div class="stat-value">' + data.totalVulnerabilities + '</div><div class="stat-label">Total Open</div></div>' +
        '<div class="stat-card"><div class="stat-value critical">' + data.criticalCount + '</div><div class="stat-label">Critical</div></div>' +
        '<div class="stat-card"><div class="stat-value resolved">' + resolvedThisWeek + '</div><div class="stat-label">Resolved (7d)</div></div>' +
        '<div class="stat-card"><div class="stat-value mttr">' + mttr + '</div><div class="stat-label">MTTR</div></div>' +
      '</div>';

      // Severity breakdown bar
      const total = (data.criticalCount || 0) + (data.highCount || 0) + (data.mediumCount || 0) + (data.lowCount || 0);
      if (total > 0) {
        html += '<div class="chart-title">Severity Distribution</div>';
        html += '<div class="mini-chart">';
        html += renderAsciiBar('CRIT', data.criticalCount || 0, total, '█');
        html += renderAsciiBar('HIGH', data.highCount || 0, total, '▓');
        html += renderAsciiBar('MED ', data.mediumCount || 0, total, '▒');
        html += renderAsciiBar('LOW ', data.lowCount || 0, total, '░');
        html += '</div>';
      }

      // Trend indicator
      html += '<div class="chart-title">Trend: ' + data.trend + ' <span class="trend-arrow">' + trendArrow + '</span></div>';

      // Weekly sparkline (if weekly data available)
      if (data.weeklyHistory && data.weeklyHistory.length > 0) {
        html += '<div class="mini-chart">';
        html += renderSparkline(data.weeklyHistory);
        html += '</div>';
      }

      // Period info
      html += '<div class="cve-meta">📅 Period: ' + escapeHtml(data.timeRange || 'Last 30 days') + '</div>';

      el.innerHTML = html;
    }

    function renderAsciiBar(label, count, total, ch) {
      const maxWidth = 20;
      const width = total > 0 ? Math.max(count > 0 ? 1 : 0, Math.round((count / total) * maxWidth)) : 0;
      const bar = ch.repeat(width);
      const pad = ' '.repeat(maxWidth - width);
      return label + ' ' + bar + pad + ' ' + count + '\\n';
    }

    function renderSparkline(values) {
      const max = Math.max(...values, 1);
      const height = 5;
      const blocks = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
      let line = 'Weekly: ';
      for (const v of values) {
        const idx = Math.round((v / max) * (blocks.length - 1));
        line += blocks[idx];
      }
      return line + '\\n';
    }

    // ── Jira Tickets Rendering ──
    function renderJira(tickets) {
      const el = document.getElementById('jiraList');
      if (!tickets.length) {
        el.innerHTML = '<div class="empty-state">No Jira tickets found</div>';
        return;
      }

      el.innerHTML = tickets.map(t => {
        const statusClass = (t.status || '').toLowerCase().replace(/\\s+/g, '-');
        return '<div class="jira-card" data-url="' + escapeHtml(t.url || '') + '">' +
          '<div class="jira-header">' +
            '<span class="jira-key">' + escapeHtml(t.key) + '</span>' +
            '<span class="status-badge ' + statusClass + '">' + escapeHtml(t.status) + '</span>' +
          '</div>' +
          '<div class="jira-summary">' + escapeHtml(t.summary) + '</div>' +
          '<div class="jira-meta">' +
            (t.priority ? '<span>⚡ ' + escapeHtml(t.priority) + '</span>' : '') +
            (t.assignee ? '<span>👤 ' + escapeHtml(t.assignee) + '</span>' : '<span>👤 Unassigned</span>') +
          '</div>' +
        '</div>';
      }).join('');

      // Click ticket → open in browser
      el.querySelectorAll('.jira-card').forEach(card => {
        card.addEventListener('click', () => {
          const url = card.dataset.url;
          if (url) {
            vscode.postMessage({ command: 'openJiraTicket', url: url });
          }
        });
      });
    }
  </script>
</body>
</html>`;
  }
}
