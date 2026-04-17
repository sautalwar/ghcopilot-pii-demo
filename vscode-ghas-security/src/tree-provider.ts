import * as vscode from 'vscode';
import { GHASApiClient, CVE, SBOMEntry } from './api-client';

const SEVERITY_ICONS: Record<string, vscode.ThemeIcon> = {
  critical: new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground')),
  high: new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground')),
  medium: new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground')),
  low: new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed')),
  none: new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed')),
};

export class DependencyTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly version: string,
    public readonly license: string,
    public readonly vulnCount: number,
    public readonly highestSeverity: string,
    public readonly cves: CVE[],
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly children: DependencyTreeItem[] = []
  ) {
    super(label, collapsibleState);
    this.description = `${version} (${license})`;

    // Rich tooltip with CVE details
    const tooltipLines = [`${label}@${version}`, `License: ${license}`, `Vulnerabilities: ${vulnCount}`];
    if (cves.length > 0) {
      tooltipLines.push('', '--- CVEs ---');
      for (const cve of cves.slice(0, 10)) {
        tooltipLines.push(`• ${cve.id} [${cve.severity?.toUpperCase()}]: ${cve.summary}`);
      }
      if (cves.length > 10) {
        tooltipLines.push(`  ... and ${cves.length - 10} more`);
      }
    }
    this.tooltip = new vscode.MarkdownString(tooltipLines.join('\n\n'));

    // Severity-based icon: 🔴 critical/high, 🟡 medium, 🟢 low/none
    this.iconPath = SEVERITY_ICONS[highestSeverity] || SEVERITY_ICONS.none;

    // Context value for context menu contributions
    this.contextValue = vulnCount > 0 ? 'dependency-vulnerable' : 'dependency-clean';
  }
}

export class DependencyTreeProvider implements vscode.TreeDataProvider<DependencyTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<DependencyTreeItem | undefined | void>();
  public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _client: GHASApiClient;
  private _rootItems: DependencyTreeItem[] = [];

  constructor() {
    this._client = new GHASApiClient();
    this.refresh();
  }

  public async refresh(): Promise<void> {
    const [sbomResult, cveResult] = await Promise.all([
      this._client.getSBOM(),
      this._client.getCVEsAffectingRepo(),
    ]);

    // Build CVE lookup by package name
    const cvesByPackage = new Map<string, CVE[]>();
    if (cveResult.success && cveResult.data) {
      for (const cve of cveResult.data) {
        if (cve.affectedPackage) {
          const existing = cvesByPackage.get(cve.affectedPackage) || [];
          existing.push(cve);
          cvesByPackage.set(cve.affectedPackage, existing);
        }
      }
    }

    this._rootItems = [];

    if (sbomResult.success && sbomResult.data) {
      const directEntries = sbomResult.data.filter(e => e.direct);
      const transitiveEntries = sbomResult.data.filter(e => !e.direct);

      // Group transitive deps by likely parent (using name prefix heuristic)
      const transitiveByParent = new Map<string, SBOMEntry[]>();
      for (const entry of transitiveEntries) {
        // Try to match transitive dep to a direct dep
        let parentKey = 'other';
        for (const direct of directEntries) {
          if (entry.name.startsWith(direct.name) || entry.name.includes(direct.name)) {
            parentKey = direct.name;
            break;
          }
        }
        const existing = transitiveByParent.get(parentKey) || [];
        existing.push(entry);
        transitiveByParent.set(parentKey, existing);
      }

      for (const entry of directEntries) {
        const pkgCves = cvesByPackage.get(entry.name) || (entry.vulnerabilities || []);
        const transitives = transitiveByParent.get(entry.name) || [];
        const highestSev = this._getHighestSeverity(pkgCves);

        const childItems = transitives.map(t => {
          const tCves = cvesByPackage.get(t.name) || (t.vulnerabilities || []);
          return new DependencyTreeItem(
            t.name,
            t.version,
            t.license,
            tCves.length,
            this._getHighestSeverity(tCves),
            tCves,
            vscode.TreeItemCollapsibleState.None
          );
        });

        const hasChildren = childItems.length > 0;
        const item = new DependencyTreeItem(
          entry.name,
          entry.version,
          entry.license,
          pkgCves.length,
          highestSev,
          pkgCves,
          hasChildren
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
          childItems
        );

        this._rootItems.push(item);
      }

      // Sort: vulnerable packages first, then alphabetically
      this._rootItems.sort((a, b) => {
        if (a.vulnCount > 0 && b.vulnCount === 0) { return -1; }
        if (a.vulnCount === 0 && b.vulnCount > 0) { return 1; }
        return a.label.localeCompare(b.label);
      });
    }

    this._onDidChangeTreeData.fire();
  }

  public getTreeItem(element: DependencyTreeItem): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: DependencyTreeItem): DependencyTreeItem[] {
    if (!element) {
      return this._rootItems;
    }
    return element.children;
  }

  private _getHighestSeverity(cves: CVE[]): string {
    const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    let highest = 'none';
    let highestRank = 99;
    for (const cve of cves) {
      const sev = (cve.severity || 'low').toLowerCase();
      const rank = order[sev] ?? 3;
      if (rank < highestRank) {
        highestRank = rank;
        highest = sev;
      }
    }
    return highest;
  }
}
