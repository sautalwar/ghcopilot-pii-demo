import fetch, { RequestInit } from 'node-fetch';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: Record<string, unknown>;
}

export interface CVE {
  id: string;
  severity: string;
  summary: string;
  affectedPackage?: string;
  affectedVersions?: string;
  fixedIn?: string;
  publishedDate?: string;
  cvssScore?: number;
}

export interface JiraTicket {
  key: string;
  summary: string;
  status: string;
  priority: string;
  assignee?: string;
  url?: string;
}

export interface GovernanceSummary {
  totalChecks: number;
  passed: number;
  failed: number;
  checks: Array<{ name: string; status: string; message: string }>;
}

export interface SBOMEntry {
  name: string;
  version: string;
  license: string;
  direct: boolean;
  vulnerabilities?: CVE[];
}

export interface TrendsSummary {
  totalVulnerabilities: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  trend: 'improving' | 'stable' | 'degrading';
  timeRange: string;
}

export interface ZeroDayAlert {
  id: string;
  cveId: string;
  severity: string;
  description: string;
  affectedPackages: string[];
  discoveredAt: string;
  cisaKEV?: boolean;
}

export interface PipelineStep {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  duration?: string;
  message?: string;
}

export interface PipelineRun {
  id: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  steps: PipelineStep[];
  prUrl?: string;
}

export class GHASApiClient {
  private baseUrl: string;
  private token?: string;

  constructor(baseUrl?: string, token?: string) {
    this.baseUrl = baseUrl || process.env.GHAS_API_URL || 'http://localhost:3000';
    this.token = token || process.env.GHAS_API_TOKEN;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(url, { ...options, headers });
      const body = await response.json() as ApiResponse<T>;
      return body;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Request failed: ${message}` };
    }
  }

  async getLatestCVEs(): Promise<ApiResponse<CVE[]>> {
    return this.request<CVE[]>('/api/cves/latest');
  }

  async getCVEsAffectingRepo(): Promise<ApiResponse<CVE[]>> {
    return this.request<CVE[]>('/api/cves/affecting-repo');
  }

  async searchJiraTickets(query?: string): Promise<ApiResponse<JiraTicket[]>> {
    const path = query ? `/api/jira/search?q=${encodeURIComponent(query)}` : '/api/jira/tickets';
    return this.request<JiraTicket[]>(path);
  }

  async createJiraTicket(data: {
    summary: string;
    description: string;
    priority: string;
    cveId?: string;
  }): Promise<ApiResponse<JiraTicket>> {
    return this.request<JiraTicket>('/api/jira/bridge', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getGovernanceSummary(): Promise<ApiResponse<GovernanceSummary>> {
    return this.request<GovernanceSummary>('/api/governance/summary');
  }

  async getSBOM(): Promise<ApiResponse<SBOMEntry[]>> {
    return this.request<SBOMEntry[]>('/api/governance/licenses/sbom');
  }

  async getZeroDayAlerts(): Promise<ApiResponse<ZeroDayAlert[]>> {
    return this.request<ZeroDayAlert[]>('/api/zero-day/active-threats');
  }

  async getTrendsSummary(): Promise<ApiResponse<TrendsSummary>> {
    return this.request<TrendsSummary>('/api/trends/summary');
  }

  async startRemediation(data: {
    cveId: string;
    packageName?: string;
  }): Promise<ApiResponse<PipelineRun>> {
    return this.request<PipelineRun>('/api/pipeline/runs', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
}
