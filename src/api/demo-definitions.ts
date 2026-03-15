import fs from "node:fs";
import path from "node:path";

export interface DemoScenario {
  id: string;
  name: string;
  description: string;
  category: "ghas" | "pii" | "security" | "compliance";
  branchName: string;
  workflowFile: string;
  incidentFiles: { path: string; contentFile: string }[];
  remediationFiles: { path: string; contentFile: string }[];
  dispatchOnly?: boolean;
  workflowInputs?: Record<string, string>;
}

const demoIncidentRoot = path.resolve(process.cwd(), "src", "demo-incidents");

function loadBase64Asset(relativePath: string): string {
  const assetPath = path.resolve(demoIncidentRoot, relativePath);

  if (!fs.existsSync(assetPath)) {
    throw new Error(`Demo incident asset not found: ${assetPath}`);
  }

  return fs.readFileSync(assetPath).toString("base64");
}

function asset(targetPath: string, relativeAssetPath: string): { path: string; contentFile: string } {
  return {
    path: targetPath,
    contentFile: loadBase64Asset(relativeAssetPath),
  };
}

export const demoScenarios: DemoScenario[] = [
  {
    id: "secret-leak",
    name: "Secret Leak Detection",
    description: "Pushes a hard-coded GitHub token to trigger secret scanning and a remediation workflow.",
    category: "security",
    branchName: "demo/secret-leak",
    workflowFile: "secret-remediation.yml",
    incidentFiles: [asset("src/live-demo/secret-leak.ts", "bad/secret-leak.ts")],
    remediationFiles: [asset("src/live-demo/secret-leak.ts", "fixed/secret-leak.ts")],
  },
  {
    id: "pii-exposure",
    name: "PII Exposure",
    description: "Pushes an unsafe citizen export to trigger PII scanning automation.",
    category: "pii",
    branchName: "demo/pii-exposure",
    workflowFile: "pii-scanner.yml",
    incidentFiles: [asset("src/live-demo/pii-data-leak.ts", "bad/pii-data-leak.ts")],
    remediationFiles: [asset("src/live-demo/pii-data-leak.ts", "fixed/pii-data-leak.ts")],
  },
  {
    id: "sql-injection",
    name: "SQL Injection",
    description: "Pushes a query builder vulnerable to injection and triggers CodeQL analysis.",
    category: "ghas",
    branchName: "demo/sql-injection",
    workflowFile: "codeql-analysis.yml",
    incidentFiles: [asset("src/live-demo/sql-injection.ts", "bad/sql-injection.ts")],
    remediationFiles: [asset("src/live-demo/sql-injection.ts", "fixed/sql-injection.ts")],
  },
  {
    id: "vuln-deps",
    name: "Vulnerable Dependencies",
    description: "Pushes an intentionally vulnerable package manifest to demonstrate dependency review.",
    category: "security",
    branchName: "demo/vuln-deps",
    workflowFile: "dependency-check.yml",
    incidentFiles: [asset("examples/vulnerable-package.json", "bad/vulnerable-package.json")],
    remediationFiles: [asset("examples/vulnerable-package.json", "fixed/vulnerable-package.json")],
  },
  {
    id: "content-exclusion",
    name: "Content Exclusion Validation",
    description: "Pushes sensitive test fixtures and Copilot exclusion rules to validate content exclusions.",
    category: "compliance",
    branchName: "demo/content-exclusion",
    workflowFile: "content-exclusion-validator.yml",
    incidentFiles: [
      asset("tests/content-exclusion/citizens-test-data.json", "bad/content-exclusion/citizens-test-data.json"),
      asset("tests/content-exclusion/copilot-e2e.spec.ts", "bad/content-exclusion/copilot-e2e.spec.ts"),
      asset(".copilotignore", "bad/content-exclusion/.copilotignore"),
    ],
    remediationFiles: [
      asset("tests/content-exclusion/citizens-test-data.json", "fixed/content-exclusion/citizens-test-data.json"),
      asset("tests/content-exclusion/copilot-e2e.spec.ts", "fixed/content-exclusion/copilot-e2e.spec.ts"),
      asset(".copilotignore", "fixed/content-exclusion/.copilotignore"),
    ],
  },
  {
    id: "audit-trail",
    name: "Audit Trail Enforcement",
    description: "Pushes an audit logging configuration change and triggers the audit logger workflow with inputs.",
    category: "compliance",
    branchName: "demo/audit-trail",
    workflowFile: "audit-logger.yml",
    incidentFiles: [asset("src/live-demo/audit-trail.ts", "bad/audit-trail.ts")],
    remediationFiles: [asset("src/live-demo/audit-trail.ts", "fixed/audit-trail.ts")],
    workflowInputs: {
      demoId: "audit-trail",
      mode: "incident",
      severity: "high",
    },
  },
  {
    id: "container-scan",
    name: "Container Security Scan",
    description: "Runs Trivy + Grype vulnerability scanning and SBOM generation against a Docker image. Demonstrates how GitHub fills GitLab's native container scanning gap with best-of-breed open-source tools.",
    category: "security",
    branchName: "main",
    workflowFile: "container-scan.yml",
    incidentFiles: [],
    remediationFiles: [],
    dispatchOnly: true,
    workflowInputs: {
      image_ref: "node:18-alpine",
      severity_threshold: "HIGH,CRITICAL",
    },
  },
  {
    id: "license-compliance",
    name: "License Compliance Check",
    description: "Scans all npm dependencies for license violations using license-checker. Demonstrates how GitHub fills GitLab's native license compliance gap with customizable policy enforcement.",
    category: "compliance",
    branchName: "main",
    workflowFile: "license-compliance.yml",
    incidentFiles: [],
    remediationFiles: [],
    dispatchOnly: true,
    workflowInputs: {
      policy_mode: "warn",
      allowed_licenses: "MIT,Apache-2.0,BSD-2-Clause,BSD-3-Clause,ISC,Unlicense,CC0-1.0,0BSD",
    },
  },
  {
    id: "dast-scan",
    name: "DAST Security Scan",
    description: "Runs OWASP ZAP dynamic security testing against a live URL. Demonstrates how GitHub fills GitLab's native DAST gap using the industry-standard open-source scanner.",
    category: "security",
    branchName: "main",
    workflowFile: "dast-scan.yml",
    incidentFiles: [],
    remediationFiles: [],
    dispatchOnly: true,
    workflowInputs: {
      target_url: "https://juice-shop.herokuapp.com",
      scan_type: "baseline",
    },
  },
];

export function getDemoScenario(demoId: string): DemoScenario | undefined {
  return demoScenarios.find((demo) => demo.id === demoId);
}
