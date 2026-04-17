import * as fs from 'fs';
import * as path from 'path';

// ---------- Types ----------

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  size?: number;
  extension?: string;
  securityIssues?: SecurityIssue[];
  issueCount?: number;
}

export interface SecurityIssue {
  type: 'secret' | 'vulnerable-import' | 'license-issue';
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  line?: number;
  pattern?: string;
}

export interface ScanSummary {
  totalFiles: number;
  scannedFiles: number;
  totalIssues: number;
  bySeverity: { critical: number; high: number; medium: number; low: number };
  byType: { secrets: number; vulnerableImports: number; licenseIssues: number };
  scanDurationMs: number;
}

export interface RepoScanResult {
  tree: FileNode;
  issues: Array<SecurityIssue & { file: string }>;
  summary: ScanSummary;
}

export interface Recommendation {
  priority: number;
  title: string;
  description: string;
  affectedFiles: string[];
  severity: 'critical' | 'high' | 'medium' | 'low';
  action: string;
}

// ---------- Constants ----------

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', '.next', 'coverage', '.nyc_output',
]);

const SKIP_FILE_EXTENSIONS = new Set(['.map', '.lock', '.db', '.sqlite']);

const SCANNABLE_EXTENSIONS = new Set([
  '.ts', '.js', '.tsx', '.jsx', '.json', '.yml', '.yaml',
  '.env', '.md', '.html', '.css',
]);

interface SecretPattern {
  name: string;
  regex: RegExp;
  severity: SecurityIssue['severity'];
  message: string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  {
    name: 'AWS Access Key',
    regex: /AKIA[0-9A-Z]{16}/,
    severity: 'critical',
    message: 'AWS access key detected',
  },
  {
    name: 'Private Key',
    regex: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
    severity: 'critical',
    message: 'Private key detected',
  },
  {
    name: 'GitHub Token',
    regex: /gh[pousr]_[A-Za-z0-9_]{36,}/,
    severity: 'critical',
    message: 'GitHub personal access token detected',
  },
  {
    name: 'JWT Token',
    regex: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/,
    severity: 'high',
    message: 'JWT token detected',
  },
  {
    name: 'Generic API Key',
    regex: /(api[_-]?key|apikey|api[_-]?secret)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    severity: 'high',
    message: 'Hardcoded API key or secret detected',
  },
  {
    name: 'Slack Token',
    regex: /xox[baprs]-[0-9A-Za-z-]{10,}/,
    severity: 'high',
    message: 'Slack token detected',
  },
  {
    name: 'Connection String',
    regex: /(mongodb|postgres|mysql|redis):\/\/[^\s'"]+/,
    severity: 'high',
    message: 'Database connection string detected',
  },
  {
    name: 'Generic Password',
    regex: /(password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/i,
    severity: 'medium',
    message: 'Hardcoded password detected',
  },
];

// ---------- Secret detection ----------

export function detectSecrets(filePath: string, content: string): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  const lines = content.split('\n');

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.regex.test(line)) {
        issues.push({
          type: 'secret',
          severity: pattern.severity,
          message: `${pattern.message} in ${path.basename(filePath)}`,
          line: lineIndex + 1,
          pattern: pattern.name,
        });
      }
    }
  }

  return issues;
}

// ---------- File tree walking ----------

function shouldSkipDir(dirName: string): boolean {
  return SKIP_DIRS.has(dirName);
}

function shouldSkipFile(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return SKIP_FILE_EXTENSIONS.has(ext);
}

function isScannableFile(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return SCANNABLE_EXTENSIONS.has(ext);
}

function walkDirectory(
  dirPath: string,
  rootDir: string,
  allIssues: Array<SecurityIssue & { file: string }>,
  stats: { totalFiles: number; scannedFiles: number },
): FileNode {
  const dirName = path.basename(dirPath);
  const relativePath = path.relative(rootDir, dirPath);

  const node: FileNode = {
    name: dirName,
    path: relativePath || '.',
    type: 'directory',
    children: [],
    issueCount: 0,
  };

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return node;
  }

  const dirs: fs.Dirent[] = [];
  const files: fs.Dirent[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name)) {
        dirs.push(entry);
      }
    } else if (entry.isFile()) {
      if (!shouldSkipFile(entry.name)) {
        files.push(entry);
      }
    }
  }

  // Sort alphabetically
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));

  // Process directories first
  for (const dir of dirs) {
    const childNode = walkDirectory(
      path.join(dirPath, dir.name),
      rootDir,
      allIssues,
      stats,
    );
    node.children!.push(childNode);
    node.issueCount! += childNode.issueCount || 0;
  }

  // Process files
  for (const file of files) {
    const filePath = path.join(dirPath, file.name);
    const fileRelativePath = path.relative(rootDir, filePath);
    const ext = path.extname(file.name).toLowerCase();

    let fileSize = 0;
    try {
      const fileStat = fs.statSync(filePath);
      fileSize = fileStat.size;
    } catch {
      // ignore stat errors
    }

    stats.totalFiles++;

    const fileNode: FileNode = {
      name: file.name,
      path: fileRelativePath,
      type: 'file',
      size: fileSize,
      extension: ext || undefined,
      issueCount: 0,
    };

    if (isScannableFile(file.name)) {
      stats.scannedFiles++;
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const issues = detectSecrets(filePath, content);
        if (issues.length > 0) {
          fileNode.securityIssues = issues;
          fileNode.issueCount = issues.length;
          node.issueCount! += issues.length;
          for (const issue of issues) {
            allIssues.push({ ...issue, file: fileRelativePath });
          }
        }
      } catch {
        // skip files that can't be read
      }
    }

    node.children!.push(fileNode);
  }

  return node;
}

// ---------- Repository scanning ----------

export function scanRepository(rootDir?: string): RepoScanResult {
  const root = rootDir || process.cwd();
  const srcDir = path.join(root, 'src');
  const startTime = Date.now();

  const allIssues: Array<SecurityIssue & { file: string }> = [];
  const stats = { totalFiles: 0, scannedFiles: 0 };

  let tree: FileNode;
  if (fs.existsSync(srcDir) && fs.statSync(srcDir).isDirectory()) {
    tree = walkDirectory(srcDir, root, allIssues, stats);
  } else {
    tree = {
      name: 'src',
      path: 'src',
      type: 'directory',
      children: [],
      issueCount: 0,
    };
  }

  const scanDurationMs = Date.now() - startTime;

  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  const byType = { secrets: 0, vulnerableImports: 0, licenseIssues: 0 };

  for (const issue of allIssues) {
    bySeverity[issue.severity]++;
    if (issue.type === 'secret') byType.secrets++;
    else if (issue.type === 'vulnerable-import') byType.vulnerableImports++;
    else if (issue.type === 'license-issue') byType.licenseIssues++;
  }

  const summary: ScanSummary = {
    totalFiles: stats.totalFiles,
    scannedFiles: stats.scannedFiles,
    totalIssues: allIssues.length,
    bySeverity,
    byType,
    scanDurationMs,
  };

  return { tree, issues: allIssues, summary };
}

// ---------- Recommendations ----------

export function getRecommendations(
  issues: Array<SecurityIssue & { file: string }>,
): Recommendation[] {
  const recommendations: Recommendation[] = [];

  // Group issues by type and pattern
  const secretsByPattern = new Map<string, Array<SecurityIssue & { file: string }>>();
  const vulnerableImports: Array<SecurityIssue & { file: string }> = [];
  const licenseIssues: Array<SecurityIssue & { file: string }> = [];

  for (const issue of issues) {
    if (issue.type === 'secret') {
      const key = issue.pattern || 'unknown';
      if (!secretsByPattern.has(key)) {
        secretsByPattern.set(key, []);
      }
      secretsByPattern.get(key)!.push(issue);
    } else if (issue.type === 'vulnerable-import') {
      vulnerableImports.push(issue);
    } else if (issue.type === 'license-issue') {
      licenseIssues.push(issue);
    }
  }

  let priority = 1;

  // Critical and high secrets first
  const severityOrder: Array<SecurityIssue['severity']> = ['critical', 'high', 'medium', 'low'];

  for (const severity of severityOrder) {
    const patternEntries = Array.from(secretsByPattern.entries());
  for (const [patternName, patternIssues] of patternEntries) {
      const matching = patternIssues.filter((i) => i.severity === severity);
      if (matching.length === 0) continue;

      const affectedFiles = Array.from(new Set(matching.map((i) => i.file)));

      recommendations.push({
        priority: priority++,
        title: `Remove hardcoded ${patternName.toLowerCase()}`,
        description: `Found ${matching.length} instance(s) of ${patternName.toLowerCase()} across ${affectedFiles.length} file(s). ` +
          'Hardcoded secrets in source code can be exposed through version control history.',
        affectedFiles,
        severity,
        action: 'Move to environment variable',
      });
    }
  }

  if (vulnerableImports.length > 0) {
    const affectedFiles = Array.from(new Set(vulnerableImports.map((i) => i.file)));
    const severity = vulnerableImports.reduce<SecurityIssue['severity']>((worst, i) => {
      const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      return order[i.severity] < order[worst] ? i.severity : worst;
    }, 'low');

    recommendations.push({
      priority: priority++,
      title: 'Update vulnerable dependencies',
      description: `Found ${vulnerableImports.length} vulnerable import(s) across ${affectedFiles.length} file(s). ` +
        'Outdated dependencies may contain known security vulnerabilities.',
      affectedFiles,
      severity,
      action: 'Update to patched version',
    });
  }

  if (licenseIssues.length > 0) {
    const affectedFiles = Array.from(new Set(licenseIssues.map((i) => i.file)));

    recommendations.push({
      priority: priority++,
      title: 'Review license compatibility',
      description: `Found ${licenseIssues.length} license concern(s) across ${affectedFiles.length} file(s). ` +
        'Ensure all dependencies use licenses compatible with your project.',
      affectedFiles,
      severity: 'low',
      action: 'Review license compatibility',
    });
  }

  return recommendations;
}
