#!/usr/bin/env node
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createJiraClient } from './jira-client';
import { isExcepted, getActiveExceptions, getExpiringSoon } from '../services/risk-exceptions-service';
import { runAllChecks, getGovernancePolicy, getCertificationReport, type GovernanceReport } from '../services/governance-service';
import { auditLicenses, getViolations, generateSBOM } from '../services/license-compliance-service';

async function main(): Promise<void> {
  const server = new McpServer({
    name: 'ghas-jira-mcp',
    version: '1.0.0',
  });

  const jira = createJiraClient();

  // ── jira_search_issues ──────────────────────────────────────────────────
  server.tool(
    'jira_search_issues',
    'Search Jira issues using JQL',
    { jql: z.string().describe('JQL query string') },
    async ({ jql }) => {
      try {
        const result = await jira.searchIssues(jql);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ── jira_create_issue ───────────────────────────────────────────────────
  server.tool(
    'jira_create_issue',
    'Create a new Jira issue',
    {
      summary: z.string().describe('Issue summary/title'),
      description: z.string().describe('Issue description'),
      priority: z.string().describe('Priority: Critical, High, Medium, or Low'),
      labels: z.array(z.string()).optional().describe('Issue labels'),
    },
    async ({ summary, description, priority, labels }) => {
      try {
        const issue = await jira.createIssue({ summary, description, priority, labels });
        return { content: [{ type: 'text' as const, text: JSON.stringify(issue, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ── jira_add_comment ────────────────────────────────────────────────────
  server.tool(
    'jira_add_comment',
    'Add a comment to a Jira issue',
    {
      issueKey: z.string().describe('Jira issue key (e.g., VULN-001)'),
      comment: z.string().describe('Comment text'),
    },
    async ({ issueKey, comment }) => {
      try {
        const result = await jira.addComment(issueKey, comment);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ── jira_transition_issue ───────────────────────────────────────────────
  server.tool(
    'jira_transition_issue',
    'Transition a Jira issue to a new status',
    {
      issueKey: z.string().describe('Jira issue key (e.g., VULN-001)'),
      status: z.string().describe('Target status: Open, In Progress, or Done'),
    },
    async ({ issueKey, status }) => {
      try {
        const issue = await jira.transitionIssue(issueKey, status);
        return { content: [{ type: 'text' as const, text: JSON.stringify(issue, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ── jira_get_issue ──────────────────────────────────────────────────────
  server.tool(
    'jira_get_issue',
    'Get a Jira issue by key',
    {
      issueKey: z.string().describe('Jira issue key (e.g., VULN-001)'),
    },
    async ({ issueKey }) => {
      try {
        const issue = await jira.getIssue(issueKey);
        const text = issue
          ? JSON.stringify(issue, null, 2)
          : `Issue ${issueKey} not found`;
        return { content: [{ type: 'text' as const, text }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ── jira_link_github ────────────────────────────────────────────────────
  server.tool(
    'jira_link_github',
    'Link a GitHub PR or issue URL to a Jira issue',
    {
      issueKey: z.string().describe('Jira issue key (e.g., VULN-001)'),
      url: z.string().describe('GitHub PR or issue URL'),
    },
    async ({ issueKey, url }) => {
      try {
        await jira.linkGitHub(issueKey, url);
        return { content: [{ type: 'text' as const, text: `Linked ${url} to ${issueKey}` }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ── Start server ────────────────────────────────────────────────────────

  // ── risk_check_exception ────────────────────────────────────────────────
  server.tool(
    'risk_check_exception',
    'Check if a file or rule is covered by a risk exception',
    {
      filePath: z.string().describe('File path to check'),
      ruleId: z.string().optional().describe('Optional rule/CWE ID to check'),
    },
    async ({ filePath, ruleId }) => {
      try {
        const result = isExcepted(filePath, ruleId);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ── risk_list_exceptions ────────────────────────────────────────────────
  server.tool(
    'risk_list_exceptions',
    'List all active risk exceptions from .ghas-policy.yml',
    {},
    async () => {
      try {
        const exceptions = getActiveExceptions();
        return { content: [{ type: 'text' as const, text: JSON.stringify(exceptions, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ── risk_expiring_soon ──────────────────────────────────────────────────
  server.tool(
    'risk_expiring_soon',
    'List risk exceptions expiring within N days',
    {
      days: z.number().optional().describe('Days to look ahead (default: 30)'),
    },
    async ({ days }) => {
      try {
        const expiring = getExpiringSoon(days);
        return { content: [{ type: 'text' as const, text: JSON.stringify(expiring, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ── governance_check_pr ─────────────────────────────────────────────────
  server.tool(
    'governance_check_pr',
    'Run all governance checks on a pull request',
    {
      prNumber: z.number().describe('Pull request number'),
      changedFiles: z.array(z.string()).optional().describe('List of changed file paths'),
    },
    async ({ prNumber, changedFiles }) => {
      try {
        const report = await runAllChecks(prNumber, changedFiles);
        return { content: [{ type: 'text' as const, text: JSON.stringify(report, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ── governance_get_policy ───────────────────────────────────────────────
  server.tool(
    'governance_get_policy',
    'Get the current governance policy from .ghas-governance.yml',
    {},
    async () => {
      try {
        const policy = getGovernancePolicy();
        return { content: [{ type: 'text' as const, text: JSON.stringify(policy, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ── governance_certification_report ─────────────────────────────────────
  server.tool(
    'governance_certification_report',
    'Generate a certification report for a PR (run governance_check_pr first)',
    {
      prNumber: z.number().describe('Pull request number'),
    },
    async ({ prNumber }) => {
      try {
        const report = await runAllChecks(prNumber);
        const cert = getCertificationReport(prNumber, report);
        return { content: [{ type: 'text' as const, text: JSON.stringify(cert, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ── license_audit ───────────────────────────────────────────────────────
  server.tool(
    'license_audit',
    'Run a full license compliance audit on the repository',
    {},
    async () => {
      try {
        const report = auditLicenses();
        return { content: [{ type: 'text' as const, text: JSON.stringify(report, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ── license_check_package ───────────────────────────────────────────────
  server.tool(
    'license_check_package',
    'Check if a specific package license is approved by policy',
    {
      packageName: z.string().describe('npm package name'),
      version: z.string().optional().describe('Package version (optional)'),
    },
    async ({ packageName, version }) => {
      try {
        const report = auditLicenses();
        const pkg = report.packages.find(p => p.packageName === packageName);
        const text = pkg
          ? JSON.stringify(pkg, null, 2)
          : `Package ${packageName} not found in dependencies`;
        return { content: [{ type: 'text' as const, text }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ── license_get_violations ──────────────────────────────────────────────
  server.tool(
    'license_get_violations',
    'Get all license compliance violations',
    {},
    async () => {
      try {
        const violations = getViolations();
        return { content: [{ type: 'text' as const, text: JSON.stringify(violations, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ── license_sbom ────────────────────────────────────────────────────────
  server.tool(
    'license_sbom',
    'Generate a Software Bill of Materials (SPDX JSON format)',
    {},
    async () => {
      try {
        const sbom = generateSBOM();
        return { content: [{ type: 'text' as const, text: JSON.stringify(sbom, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ── Connect transport ──────────────────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[ghas-jira-mcp] MCP server running on stdio');
}

main().catch((err) => {
  console.error('[ghas-jira-mcp] Fatal error:', err);
  process.exit(1);
});
