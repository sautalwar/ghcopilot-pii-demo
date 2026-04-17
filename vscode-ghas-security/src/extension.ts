import * as vscode from 'vscode';
import { GHASApiClient, CVE } from './api-client';
import { GHASSidebarProvider } from './sidebar-provider';
import { GHASCodeLensProvider } from './codelens-provider';
import { DependencyTreeProvider } from './tree-provider';

let statusBarItem: vscode.StatusBarItem;
let diagnosticCollection: vscode.DiagnosticCollection;
let outputChannel: vscode.OutputChannel;

/**
 * First-run onboarding: walks the user through server & credential config
 * if ghas.server.url hasn't been set yet.
 */
async function runOnboarding(): Promise<void> {
  const config = vscode.workspace.getConfiguration('ghas');
  const serverUrl = config.get<string>('server.url');

  // Only trigger onboarding if the default localhost value is still present
  if (serverUrl && serverUrl !== 'http://localhost:3000') {
    return;
  }

  const action = await vscode.window.showInformationMessage(
    'GHAS Security: No API server configured. Set up now?',
    'Configure',
    'Skip'
  );
  if (action !== 'Configure') { return; }

  // Step 1: Server URL
  const url = await vscode.window.showInputBox({
    prompt: 'Step 1/5 — GHAS API Server URL',
    placeHolder: 'http://localhost:3000',
    value: 'http://localhost:3000',
    ignoreFocusOut: true,
  });
  if (url) {
    await config.update('server.url', url, vscode.ConfigurationTarget.Workspace);
  }

  // Step 2: Jira Base URL
  const jiraUrl = await vscode.window.showInputBox({
    prompt: 'Step 2/5 — Jira Base URL (leave empty to skip)',
    placeHolder: 'https://yourorg.atlassian.net',
    ignoreFocusOut: true,
  });
  if (jiraUrl) {
    await config.update('jira.baseUrl', jiraUrl, vscode.ConfigurationTarget.Workspace);
  }

  // Step 3: Jira Email
  const jiraEmail = await vscode.window.showInputBox({
    prompt: 'Step 3/5 — Jira Account Email (leave empty to skip)',
    placeHolder: 'you@company.com',
    ignoreFocusOut: true,
  });
  if (jiraEmail) {
    await config.update('jira.email', jiraEmail, vscode.ConfigurationTarget.Workspace);
  }

  // Step 4: Jira API Token
  const jiraToken = await vscode.window.showInputBox({
    prompt: 'Step 4/5 — Jira API Token (leave empty to skip)',
    placeHolder: 'Your Jira API token',
    password: true,
    ignoreFocusOut: true,
  });
  if (jiraToken) {
    await config.update('jira.apiToken', jiraToken, vscode.ConfigurationTarget.Workspace);
  }

  // Step 5: GitHub Token
  const ghToken = await vscode.window.showInputBox({
    prompt: 'Step 5/5 — GitHub Personal Access Token (leave empty to skip)',
    placeHolder: 'ghp_...',
    password: true,
    ignoreFocusOut: true,
  });
  if (ghToken) {
    await config.update('github.token', ghToken, vscode.ConfigurationTarget.Workspace);
  }

  vscode.window.showInformationMessage('GHAS Security configured! Run "GHAS: Scan for Vulnerabilities" to get started.');
}

/**
 * Publish CVEs as VS Code diagnostics so they appear in the Problems panel.
 */
function publishDiagnostics(cves: CVE[]): void {
  diagnosticCollection.clear();

  // Group CVEs by affected package, then try to find matching files
  const byPackage = new Map<string, CVE[]>();
  for (const cve of cves) {
    const pkg = cve.affectedPackage || 'unknown';
    const existing = byPackage.get(pkg) || [];
    existing.push(cve);
    byPackage.set(pkg, existing);
  }

  // For each workspace folder, scan open documents for import lines referencing vulnerable packages
  const docs = vscode.workspace.textDocuments;
  for (const doc of docs) {
    if (!['javascript', 'typescript', 'javascriptreact', 'typescriptreact'].includes(doc.languageId)) {
      continue;
    }

    const diagnostics: vscode.Diagnostic[] = [];
    const lines = doc.getText().split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const esMatch = /import\s+(?:(?:[\w*{}\s,]+)\s+from\s+)?['"]([^'"]+)['"]/.exec(line);
      const cjsMatch = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/.exec(line);
      const pkgRaw = esMatch?.[1] || cjsMatch?.[1];
      if (!pkgRaw) { continue; }

      // Get base package name
      let basePkg: string;
      if (pkgRaw.startsWith('@')) {
        const parts = pkgRaw.split('/');
        basePkg = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : pkgRaw;
      } else {
        basePkg = pkgRaw.split('/')[0];
      }

      const pkgCves = byPackage.get(basePkg);
      if (!pkgCves || pkgCves.length === 0) { continue; }

      for (const cve of pkgCves) {
        const severity = mapSeverity(cve.severity);
        const diag = new vscode.Diagnostic(
          new vscode.Range(i, 0, i, line.length),
          `${cve.id}: ${cve.summary} [${(cve.severity || 'unknown').toUpperCase()}]`,
          severity
        );
        diag.source = 'GHAS Security';
        diag.code = {
          value: cve.id,
          target: vscode.Uri.parse(`https://nvd.nist.gov/vuln/detail/${cve.id}`),
        };
        diagnostics.push(diag);
      }
    }

    if (diagnostics.length > 0) {
      diagnosticCollection.set(doc.uri, diagnostics);
    }
  }
}

function mapSeverity(severity: string | undefined): vscode.DiagnosticSeverity {
  switch ((severity || '').toLowerCase()) {
    case 'critical':
    case 'high':
      return vscode.DiagnosticSeverity.Error;
    case 'medium':
      return vscode.DiagnosticSeverity.Warning;
    case 'low':
      return vscode.DiagnosticSeverity.Information;
    default:
      return vscode.DiagnosticSeverity.Hint;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const client = new GHASApiClient();

  // --- Output Channel ---
  outputChannel = vscode.window.createOutputChannel('GHAS Security');
  context.subscriptions.push(outputChannel);

  // --- Diagnostics ---
  diagnosticCollection = vscode.languages.createDiagnosticCollection('ghas-security');
  context.subscriptions.push(diagnosticCollection);

  // --- Sidebar ---
  const sidebarProvider = new GHASSidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      GHASSidebarProvider.viewType,
      sidebarProvider
    )
  );

  // --- CodeLens ---
  const codeLensProvider = new GHASCodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [
        { language: 'javascript', scheme: 'file' },
        { language: 'typescript', scheme: 'file' },
        { language: 'javascriptreact', scheme: 'file' },
        { language: 'typescriptreact', scheme: 'file' },
      ],
      codeLensProvider
    )
  );

  // --- Tree View ---
  const depTreeProvider = new DependencyTreeProvider();
  context.subscriptions.push(
    vscode.window.createTreeView('ghas-dependencies', {
      treeDataProvider: depTreeProvider,
      showCollapseAll: true,
    })
  );

  // --- Status Bar ---
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBarItem.text = '$(shield) GHAS';
  statusBarItem.tooltip = 'GHAS Security Dashboard — Click to open sidebar';
  statusBarItem.command = 'ghas-vulnerabilities.focus';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // --- Commands ---

  // Scan command — fetches CVEs, updates status bar, publishes diagnostics
  context.subscriptions.push(
    vscode.commands.registerCommand('ghas.scan', async () => {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'GHAS: Scanning for vulnerabilities...' },
        () => client.getCVEsAffectingRepo()
      );
      if (result.success && result.data) {
        const count = result.data.length;
        const critical = result.data.filter(c => c.severity?.toLowerCase() === 'critical').length;
        statusBarItem.text = critical > 0
          ? `$(shield) GHAS: ${count} CVE${count !== 1 ? 's' : ''} (${critical} critical)`
          : `$(shield) GHAS: ${count} CVE${count !== 1 ? 's' : ''}`;
        statusBarItem.backgroundColor = critical > 0
          ? new vscode.ThemeColor('statusBarItem.errorBackground')
          : undefined;
        codeLensProvider.refresh();
        publishDiagnostics(result.data);
        outputChannel.appendLine(`[${new Date().toISOString()}] Scan complete: ${count} vulnerabilities found`);
        for (const cve of result.data) {
          outputChannel.appendLine(`  ${cve.id} [${cve.severity}] ${cve.affectedPackage || ''} — ${cve.summary}`);
        }
        vscode.window.showInformationMessage(`GHAS Scan complete: ${count} vulnerabilities found.`);
      } else {
        outputChannel.appendLine(`[${new Date().toISOString()}] Scan failed: ${result.error}`);
        vscode.window.showErrorMessage(`GHAS Scan failed: ${result.error || 'Unknown error'}`);
      }
    })
  );

  // Create Jira Ticket
  context.subscriptions.push(
    vscode.commands.registerCommand('ghas.createJiraTicket', async () => {
      const summary = await vscode.window.showInputBox({
        prompt: 'Jira ticket summary',
        placeHolder: 'e.g. Fix CVE-2024-1234 in express',
      });
      if (!summary) { return; }

      const description = await vscode.window.showInputBox({
        prompt: 'Ticket description',
        placeHolder: 'Describe the vulnerability and remediation steps',
      });

      const result = await client.createJiraTicket({
        summary,
        description: description || '',
        priority: 'High',
      });

      if (result.success && result.data) {
        outputChannel.appendLine(`[${new Date().toISOString()}] Jira ticket created: ${result.data.key}`);
        vscode.window.showInformationMessage(`Jira ticket created: ${result.data.key}`);
      } else {
        vscode.window.showErrorMessage(`Failed to create Jira ticket: ${result.error || 'Unknown error'}`);
      }
    })
  );

  // Governance Check
  context.subscriptions.push(
    vscode.commands.registerCommand('ghas.runGovernanceCheck', async () => {
      const prInput = await vscode.window.showInputBox({
        prompt: 'Enter PR number to check',
        placeHolder: 'e.g. 42',
      });
      if (!prInput) { return; }

      const prNumber = parseInt(prInput, 10);
      if (isNaN(prNumber)) {
        vscode.window.showErrorMessage('Invalid PR number');
        return;
      }

      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `GHAS: Running governance check on PR #${prNumber}...` },
        () => client.runGovernanceCheck(prNumber)
      );

      if (result.success && result.data) {
        const status = result.data.passed ? '✅ Passed' : '❌ Failed';
        outputChannel.appendLine(`[${new Date().toISOString()}] Governance check PR #${prNumber}: ${status}`);
        if (result.data.checks) {
          for (const check of result.data.checks) {
            outputChannel.appendLine(`  ${check.status === 'passed' ? '✅' : '❌'} ${check.name}: ${check.message}`);
          }
        }
        outputChannel.show(true);
        vscode.window.showInformationMessage(`Governance check ${status}`);
      } else {
        vscode.window.showErrorMessage(`Governance check failed: ${result.error || 'Unknown error'}`);
      }
    })
  );

  // Show Dependency Tree
  context.subscriptions.push(
    vscode.commands.registerCommand('ghas.showDepTree', async () => {
      await depTreeProvider.refresh();
      vscode.commands.executeCommand('ghas-dependencies.focus');
    })
  );

  // Generate SBOM
  context.subscriptions.push(
    vscode.commands.registerCommand('ghas.generateSbom', async () => {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'GHAS: Generating SBOM...' },
        () => client.getSBOM()
      );

      if (result.success && result.data) {
        const doc = await vscode.workspace.openTextDocument({
          content: JSON.stringify(result.data, null, 2),
          language: 'json',
        });
        await vscode.window.showTextDocument(doc);
      } else {
        vscode.window.showErrorMessage(`SBOM generation failed: ${result.error || 'Unknown error'}`);
      }
    })
  );

  // Show CVE Feed — opens sidebar to CVE tab
  context.subscriptions.push(
    vscode.commands.registerCommand('ghas.showCveFeed', async () => {
      await vscode.commands.executeCommand('ghas-vulnerabilities.focus');
    })
  );

  // Show CVE Details — used by CodeLens
  context.subscriptions.push(
    vscode.commands.registerCommand('ghas.showCveDetails', async (packageName: string, cves: CVE[]) => {
      if (!cves || cves.length === 0) {
        vscode.window.showInformationMessage(`No CVE details available for ${packageName}`);
        return;
      }
      outputChannel.appendLine(`\n--- CVEs for ${packageName} ---`);
      for (const cve of cves) {
        outputChannel.appendLine(`${cve.id} [${cve.severity?.toUpperCase()}] CVSS: ${cve.cvssScore ?? 'N/A'}`);
        outputChannel.appendLine(`  ${cve.summary}`);
        outputChannel.appendLine(`  Affected: ${cve.affectedVersions || 'all'} | Fix: ${cve.fixedIn || 'none yet'}`);
      }
      outputChannel.show(true);
    })
  );

  // Show Trends
  context.subscriptions.push(
    vscode.commands.registerCommand('ghas.showTrends', async () => {
      const result = await client.getTrendsSummary();
      if (result.success && result.data) {
        outputChannel.appendLine(`\n--- Vulnerability Trends ---`);
        outputChannel.appendLine(`Total: ${result.data.totalVulnerabilities}`);
        outputChannel.appendLine(`Critical: ${result.data.criticalCount} | High: ${result.data.highCount} | Medium: ${result.data.mediumCount} | Low: ${result.data.lowCount}`);
        outputChannel.appendLine(`Trend: ${result.data.trend} | Period: ${result.data.timeRange}`);
        outputChannel.show(true);
      } else {
        vscode.window.showErrorMessage(`Failed to load trends: ${result.error || 'Unknown error'}`);
      }
    })
  );

  // Context menu: Create Jira Ticket from tree item
  context.subscriptions.push(
    vscode.commands.registerCommand('ghas.createTicketFromDep', async (item: { label: string; cves?: CVE[] }) => {
      const cves = item.cves || [];
      const summary = `Vulnerability in ${item.label}` + (cves.length > 0 ? ` (${cves.length} CVEs)` : '');
      const description = cves.map(c => `- ${c.id} [${c.severity}]: ${c.summary}`).join('\n');
      const result = await client.createJiraTicket({
        summary,
        description,
        priority: 'High',
        cveId: cves[0]?.id,
      });
      if (result.success && result.data) {
        vscode.window.showInformationMessage(`Jira ticket created: ${result.data.key}`);
      } else {
        vscode.window.showErrorMessage(`Failed: ${result.error || 'Unknown error'}`);
      }
    })
  );

  // Context menu: View in NVD
  context.subscriptions.push(
    vscode.commands.registerCommand('ghas.viewInNVD', (item: { cves?: CVE[] }) => {
      const cves = item.cves || [];
      if (cves.length > 0) {
        vscode.env.openExternal(
          vscode.Uri.parse(`https://nvd.nist.gov/vuln/detail/${cves[0].id}`)
        );
      }
    })
  );

  // --- Onboarding ---
  runOnboarding();

  // Re-publish diagnostics when text documents open/change
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(() => {
      // Re-run diagnostics with cached data
    }),
    vscode.workspace.onDidSaveTextDocument(() => {
      codeLensProvider.refresh();
    })
  );

  outputChannel.appendLine(`[${new Date().toISOString()}] GHAS Security extension activated`);
}

export function deactivate(): void {
  if (statusBarItem) {
    statusBarItem.dispose();
  }
  if (diagnosticCollection) {
    diagnosticCollection.dispose();
  }
}
