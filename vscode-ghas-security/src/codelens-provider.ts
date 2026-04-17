import * as vscode from 'vscode';
import { GHASApiClient, CVE } from './api-client';

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export class GHASCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  private _vulnerablePackages: Map<string, CVE[]> = new Map();
  private _client: GHASApiClient;
  private _lastRefresh = 0;
  private _refreshIntervalMs = 5 * 60 * 1000; // 5 minutes
  private _loading = false;

  constructor() {
    this._client = new GHASApiClient();
    this._loadVulnerablePackages();
  }

  public refresh(): void {
    this._lastRefresh = 0; // force next load
    this._loadVulnerablePackages();
    this._onDidChangeCodeLenses.fire();
  }

  private async _loadVulnerablePackages(): Promise<void> {
    const now = Date.now();
    if (this._loading || (now - this._lastRefresh < this._refreshIntervalMs)) {
      return;
    }
    this._loading = true;

    try {
      const result = await this._client.getCVEsAffectingRepo();
      this._vulnerablePackages.clear();
      if (result.success && result.data) {
        for (const cve of result.data) {
          if (cve.affectedPackage) {
            const existing = this._vulnerablePackages.get(cve.affectedPackage) || [];
            existing.push(cve);
            this._vulnerablePackages.set(cve.affectedPackage, existing);
          }
        }
      }
      this._lastRefresh = Date.now();
      this._onDidChangeCodeLenses.fire();
    } finally {
      this._loading = false;
    }
  }

  public provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.CodeLens[] {
    // Refresh cache if stale
    if (Date.now() - this._lastRefresh > this._refreshIntervalMs) {
      this._loadVulnerablePackages();
    }

    const lenses: vscode.CodeLens[] = [];
    const text = document.getText();
    const lines = text.split('\n');

    // ES module imports: import X from 'pkg', import { X } from 'pkg', import 'pkg'
    const esImportRegex = /import\s+(?:(?:[\w*{}\s,]+)\s+from\s+)?['"]([^'"]+)['"]/;
    // CommonJS require: require('pkg'), require("pkg")
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/;
    // Dynamic import: import('pkg')
    const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const packageName = this._extractPackageName(line, esImportRegex)
        || this._extractPackageName(line, requireRegex)
        || this._extractPackageName(line, dynamicImportRegex);

      if (!packageName) { continue; }

      const baseName = this._getBasePackageName(packageName);
      // Skip relative/absolute paths (local modules)
      if (baseName.startsWith('.') || baseName.startsWith('/')) { continue; }

      const cves = this._vulnerablePackages.get(baseName);
      if (!cves || cves.length === 0) { continue; }

      const range = new vscode.Range(i, 0, i, lines[i].length);
      const highestSeverity = this._getHighestSeverity(cves);
      const lens = new vscode.CodeLens(range, {
        title: `⚠️ ${cves.length} CVE(s) — ${highestSeverity.toUpperCase()} severity`,
        command: 'ghas.showCveDetails',
        tooltip: cves.map(c => `${c.id}: ${c.summary}`).join('\n'),
        arguments: [baseName, cves],
      });
      lenses.push(lens);
    }

    return lenses;
  }

  private _extractPackageName(line: string, regex: RegExp): string | null {
    const match = regex.exec(line);
    return match ? match[1] : null;
  }

  private _getBasePackageName(raw: string): string {
    // Handle scoped packages like @org/package or @org/package/subpath
    if (raw.startsWith('@')) {
      const parts = raw.split('/');
      return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : raw;
    }
    // Regular packages — just the first segment (e.g. 'express' from 'express/lib/router')
    return raw.split('/')[0];
  }

  private _getHighestSeverity(cves: CVE[]): string {
    let highest = 'low';
    let highestRank = 3;
    for (const cve of cves) {
      const sev = (cve.severity || 'low').toLowerCase();
      const rank = SEVERITY_ORDER[sev] ?? 3;
      if (rank < highestRank) {
        highestRank = rank;
        highest = sev;
      }
    }
    return highest;
  }
}
