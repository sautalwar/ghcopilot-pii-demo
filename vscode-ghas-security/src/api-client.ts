import * as vscode from 'vscode';
import fetch, { RequestInit } from 'node-fetch';

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

export interface GovernanceResult {
  passed: boolean;
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
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: Record<string, unknown>;
}

export class GHASApiClient {
  private baseUrl: string;
  private token?: string;

  constructor() {
    const config = vscode.workspace.getConfiguration('ghas');
    this.baseUrl = config.get<string>('server.url') || 'http://localhost:3000';
    this.token = config.get<string>('github.token') || undefined;
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

  async getJiraTickets(): Promise<ApiResponse<JiraTicket[]>> {
    return this.request<JiraTicket[]>('/api/jira/tickets');
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

  async getGovernancePolicy(): Promise<ApiResponse<Record<string, unknown>>> {
    return this.request<Record<string, unknown>>('/api/governance/policy');
  }

  async runGovernanceCheck(prNumber: number): Promise<ApiResponse<GovernanceResult>> {
    return this.request<GovernanceResult>(`/api/governance/check/${prNumber}`, {
      method: 'POST',
    });
  }

  async getLicenseAudit(): Promise<ApiResponse<SBOMEntry[]>> {
    return this.request<SBOMEntry[]>('/api/governance/licenses');
  }

  async getSBOM(): Promise<ApiResponse<SBOMEntry[]>> {
    return this.request<SBOMEntry[]>('/api/governance/licenses/sbom');
  }

  async getTrendsSummary(): Promise<ApiResponse<TrendsSummary>> {
    return this.request<TrendsSummary>('/api/trends/summary');
  }

  async getZeroDayAlerts(): Promise<ApiResponse<ZeroDayAlert[]>> {
    return this.request<ZeroDayAlert[]>('/api/zero-day/active-threats');
  }
}
