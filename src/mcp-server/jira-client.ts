import Database from 'better-sqlite3';
import path from 'path';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface JiraComment {
  id: string;
  author: string;
  body: string;
  created: string;
}

export interface JiraIssue {
  key: string;
  summary: string;
  description: string;
  status: string;
  priority: string;
  assignee: string | null;
  labels: string[];
  created: string;
  updated: string;
  comments: JiraComment[];
  links: string[];
}

export interface JiraSearchResult {
  total: number;
  issues: JiraIssue[];
}

export interface JiraCreateInput {
  summary: string;
  description: string;
  priority: string;
  labels?: string[];
  assignee?: string;
}

export interface IJiraClient {
  searchIssues(jql: string): Promise<JiraSearchResult>;
  createIssue(input: JiraCreateInput): Promise<JiraIssue>;
  addComment(issueKey: string, comment: string): Promise<JiraComment>;
  transitionIssue(issueKey: string, status: string): Promise<JiraIssue>;
  getIssue(issueKey: string): Promise<JiraIssue | null>;
  linkGitHub(issueKey: string, url: string): Promise<void>;
}

// ── Jira Cloud Client ───────────────────────────────────────────────────────

class JiraCloudClient implements IJiraClient {
  private baseUrl: string;
  private authHeader: string;

  constructor() {
    this.baseUrl = process.env.JIRA_BASE_URL || '';
    const email = process.env.JIRA_EMAIL || '';
    const token = process.env.JIRA_API_TOKEN || '';
    this.authHeader = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;

    if (!this.baseUrl) {
      throw new Error('[Jira-Cloud] JIRA_BASE_URL is required');
    }
  }

  private async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseUrl}/rest/api/3${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`[Jira-Cloud] ${response.status} ${response.statusText}: ${body}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  private mapIssue(raw: any): JiraIssue {
    const fields = raw.fields || {};
    return {
      key: raw.key,
      summary: fields.summary || '',
      description: typeof fields.description === 'string'
        ? fields.description
        : JSON.stringify(fields.description || ''),
      status: fields.status?.name || 'Unknown',
      priority: fields.priority?.name || 'Medium',
      assignee: fields.assignee?.displayName || null,
      labels: fields.labels || [],
      created: fields.created || new Date().toISOString(),
      updated: fields.updated || new Date().toISOString(),
      comments: [],
      links: [],
    };
  }

  async searchIssues(jql: string): Promise<JiraSearchResult> {
    const data = await this.request('/search/jql', {
      method: 'POST',
      body: JSON.stringify({ jql, maxResults: 50 }),
    });

    return {
      total: data.total || 0,
      issues: (data.issues || []).map((i: any) => this.mapIssue(i)),
    };
  }

  async createIssue(input: JiraCreateInput): Promise<JiraIssue> {
    const projectKey = process.env.JIRA_PROJECT_KEY || 'VULN';
    const data = await this.request('/issue', {
      method: 'POST',
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          summary: input.summary,
          description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: input.description }] }] },
          issuetype: { name: 'Bug' },
          priority: { name: input.priority },
          labels: input.labels || [],
          ...(input.assignee ? { assignee: { name: input.assignee } } : {}),
        },
      }),
    });

    const issue = await this.getIssue(data.key);
    return issue!;
  }

  async addComment(issueKey: string, comment: string): Promise<JiraComment> {
    const data = await this.request(`/issue/${issueKey}/comment`, {
      method: 'POST',
      body: JSON.stringify({
        body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: comment }] }] },
      }),
    });

    return {
      id: data.id,
      author: data.author?.displayName || 'Unknown',
      body: comment,
      created: data.created || new Date().toISOString(),
    };
  }

  async transitionIssue(issueKey: string, status: string): Promise<JiraIssue> {
    const transData = await this.request(`/issue/${issueKey}/transitions`);
    const transition = (transData.transitions || []).find(
      (t: any) => t.name.toLowerCase() === status.toLowerCase()
    );

    if (!transition) {
      throw new Error(`[Jira-Cloud] No transition found to status "${status}" for ${issueKey}`);
    }

    await this.request(`/issue/${issueKey}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ transition: { id: transition.id } }),
    });

    const issue = await this.getIssue(issueKey);
    return issue!;
  }

  async getIssue(issueKey: string): Promise<JiraIssue | null> {
    try {
      const data = await this.request(`/issue/${issueKey}`);
      return this.mapIssue(data);
    } catch {
      return null;
    }
  }

  async linkGitHub(issueKey: string, url: string): Promise<void> {
    await this.request(`/issue/${issueKey}/remotelink`, {
      method: 'POST',
      body: JSON.stringify({
        object: { url, title: `GitHub: ${url}` },
      }),
    });
  }
}

// ── Jira Mock Client (SQLite-backed) ────────────────────────────────────────

class JiraMockClient implements IJiraClient {
  private db: Database.Database;
  private projectKey: string;

  constructor() {
    const dbPath = path.resolve(process.cwd(), 'data', 'jira-mock.db');
    this.db = new Database(dbPath);
    this.projectKey = process.env.JIRA_PROJECT_KEY || 'VULN';
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS issues (
        key TEXT PRIMARY KEY,
        summary TEXT,
        description TEXT,
        status TEXT DEFAULT 'Open',
        priority TEXT DEFAULT 'Medium',
        assignee TEXT,
        labels TEXT,
        created TEXT,
        updated TEXT
      );
      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        issue_key TEXT,
        author TEXT,
        body TEXT,
        created TEXT
      );
      CREATE TABLE IF NOT EXISTS links (
        issue_key TEXT,
        url TEXT
      );
    `);
  }

  private nextKey(): string {
    const row = this.db.prepare(
      `SELECT key FROM issues WHERE key LIKE ? ORDER BY CAST(SUBSTR(key, LENGTH(?) + 2) AS INTEGER) DESC LIMIT 1`
    ).get(`${this.projectKey}-%`, this.projectKey) as { key: string } | undefined;

    if (!row) return `${this.projectKey}-001`;

    const num = parseInt(row.key.split('-').pop()!, 10) + 1;
    return `${this.projectKey}-${String(num).padStart(3, '0')}`;
  }

  private rowToIssue(row: any): JiraIssue {
    const comments = this.db.prepare(
      'SELECT id, author, body, created FROM comments WHERE issue_key = ? ORDER BY created'
    ).all(row.key) as JiraComment[];

    const linkRows = this.db.prepare(
      'SELECT url FROM links WHERE issue_key = ?'
    ).all(row.key) as { url: string }[];

    return {
      key: row.key,
      summary: row.summary || '',
      description: row.description || '',
      status: row.status || 'Open',
      priority: row.priority || 'Medium',
      assignee: row.assignee || null,
      labels: row.labels ? JSON.parse(row.labels) : [],
      created: row.created || '',
      updated: row.updated || '',
      comments,
      links: linkRows.map(l => l.url),
    };
  }

  async searchIssues(jql: string): Promise<JiraSearchResult> {
    const conditions = this.parseJQL(jql);
    let sql = 'SELECT * FROM issues';
    const params: string[] = [];

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.map(c => c.clause).join(' AND ');
      conditions.forEach(c => params.push(...c.params));
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    const issues = rows.map(r => this.rowToIssue(r));

    return { total: issues.length, issues };
  }

  private parseJQL(jql: string): { clause: string; params: string[] }[] {
    const conditions: { clause: string; params: string[] }[] = [];
    // Normalize OR to split into UNION-like conditions handled via LIKE
    // Support: field ~ "value", field = "value", combined with AND/OR
    const parts = jql.split(/\s+AND\s+/i);

    for (const part of parts) {
      const trimmed = part.trim();
      // Handle OR within a part
      const orParts = trimmed.split(/\s+OR\s+/i);

      if (orParts.length > 1) {
        const orClauses: string[] = [];
        const orParams: string[] = [];
        for (const op of orParts) {
          const parsed = this.parseSingleCondition(op.trim());
          if (parsed) {
            orClauses.push(parsed.clause);
            orParams.push(...parsed.params);
          }
        }
        if (orClauses.length > 0) {
          conditions.push({ clause: `(${orClauses.join(' OR ')})`, params: orParams });
        }
      } else {
        const parsed = this.parseSingleCondition(trimmed);
        if (parsed) conditions.push(parsed);
      }
    }

    return conditions;
  }

  private parseSingleCondition(expr: string): { clause: string; params: string[] } | null {
    // Match: field ~ "value" (contains)
    const containsMatch = expr.match(/^(\w+)\s*~\s*"([^"]*)"$/);
    if (containsMatch) {
      const [, field, value] = containsMatch;
      const col = this.sanitizeColumn(field);
      if (!col) return null;
      return { clause: `${col} LIKE ?`, params: [`%${value}%`] };
    }

    // Match: field = "value" (exact)
    const exactMatch = expr.match(/^(\w+)\s*=\s*"([^"]*)"$/);
    if (exactMatch) {
      const [, field, value] = exactMatch;
      const col = this.sanitizeColumn(field);
      if (!col) return null;
      return { clause: `${col} = ?`, params: [value] };
    }

    return null;
  }

  private sanitizeColumn(field: string): string | null {
    const allowed = ['key', 'summary', 'description', 'status', 'priority', 'assignee', 'labels'];
    const lower = field.toLowerCase();
    return allowed.includes(lower) ? lower : null;
  }

  async createIssue(input: JiraCreateInput): Promise<JiraIssue> {
    const key = this.nextKey();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO issues (key, summary, description, status, priority, assignee, labels, created, updated)
      VALUES (?, ?, ?, 'Open', ?, ?, ?, ?, ?)
    `).run(
      key,
      input.summary,
      input.description,
      input.priority || 'Medium',
      input.assignee || null,
      JSON.stringify(input.labels || []),
      now,
      now,
    );

    return this.rowToIssue(
      this.db.prepare('SELECT * FROM issues WHERE key = ?').get(key)
    );
  }

  async addComment(issueKey: string, comment: string): Promise<JiraComment> {
    const id = `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    this.db.prepare(
      'INSERT INTO comments (id, issue_key, author, body, created) VALUES (?, ?, ?, ?, ?)'
    ).run(id, issueKey, 'copilot-mcp', comment, now);

    this.db.prepare('UPDATE issues SET updated = ? WHERE key = ?').run(now, issueKey);

    return { id, author: 'copilot-mcp', body: comment, created: now };
  }

  async transitionIssue(issueKey: string, status: string): Promise<JiraIssue> {
    const validStatuses = ['Open', 'In Progress', 'Done'];
    const normalized = validStatuses.find(s => s.toLowerCase() === status.toLowerCase());
    if (!normalized) {
      throw new Error(`[Jira-Mock] Invalid status "${status}". Valid: ${validStatuses.join(', ')}`);
    }

    const now = new Date().toISOString();
    this.db.prepare('UPDATE issues SET status = ?, updated = ? WHERE key = ?')
      .run(normalized, now, issueKey);

    const row = this.db.prepare('SELECT * FROM issues WHERE key = ?').get(issueKey);
    if (!row) throw new Error(`[Jira-Mock] Issue ${issueKey} not found`);

    return this.rowToIssue(row);
  }

  async getIssue(issueKey: string): Promise<JiraIssue | null> {
    const row = this.db.prepare('SELECT * FROM issues WHERE key = ?').get(issueKey) as any;
    return row ? this.rowToIssue(row) : null;
  }

  async linkGitHub(issueKey: string, url: string): Promise<void> {
    this.db.prepare('INSERT INTO links (issue_key, url) VALUES (?, ?)').run(issueKey, url);
    const now = new Date().toISOString();
    this.db.prepare('UPDATE issues SET updated = ? WHERE key = ?').run(now, issueKey);
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createJiraClient(): IJiraClient {
  const mode = (process.env.JIRA_MODE || 'mock').toLowerCase();
  if (mode === 'cloud') {
    return new JiraCloudClient();
  }
  return new JiraMockClient();
}
