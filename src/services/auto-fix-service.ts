import { GitHubClient, PullRequestSummary } from "../api/github-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FixDescription {
  findingId: string;
  findingType: "code-scanning" | "secret-scanning" | "dependabot" | "secret-pattern";
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  whatIsWrong: string;
  whyItMatters: string;
  howToFix: string;
  codeExample?: string;
  estimatedEffort: "trivial" | "small" | "medium" | "large";
  autoFixAvailable: boolean;
  references: string[];
}

export interface RemediationPR {
  findingId: string;
  repo: string;
  prNumber?: number;
  prUrl?: string;
  branchName: string;
  status: "creating" | "open" | "review" | "approved" | "merged" | "failed";
  assignedTo: string;
  createdAt: string;
  mergedAt?: string;
}

export interface RemediationResult {
  finding: FixDescription;
  pr?: RemediationPR;
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Finding input shape
// ---------------------------------------------------------------------------

interface FindingInput {
  type: string;
  severity: string;
  title: string;
  description?: string;
  package?: string;
  cveId?: string;
  file?: string;
  line?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<string, FixDescription["severity"]> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
};

function normalizeSeverity(raw: string): FixDescription["severity"] {
  return SEVERITY_ORDER[raw.toLowerCase()] ?? "medium";
}

function normalizeFindingType(raw: string): FixDescription["findingType"] {
  const map: Record<string, FixDescription["findingType"]> = {
    "code-scanning": "code-scanning",
    "secret-scanning": "secret-scanning",
    dependabot: "dependabot",
    "secret-pattern": "secret-pattern",
    codeql: "code-scanning",
    secret: "secret-scanning",
    dependency: "dependabot",
  };
  return map[raw.toLowerCase()] ?? "code-scanning";
}

function effortFromSeverity(sev: FixDescription["severity"]): FixDescription["estimatedEffort"] {
  switch (sev) {
    case "critical":
      return "small";
    case "high":
      return "small";
    case "medium":
      return "medium";
    case "low":
      return "trivial";
  }
}

function sanitizeForBranch(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "-").substring(0, 100);
}

// ---------------------------------------------------------------------------
// Fix-description templates
// ---------------------------------------------------------------------------

function describeSecretScanning(finding: FindingInput, severity: FixDescription["severity"]): FixDescription {
  const secretType = finding.title || "secret";
  const file = finding.file ?? "source code";
  return {
    findingId: `secret-${Date.now()}`,
    findingType: "secret-scanning",
    severity,
    title: finding.title,
    whatIsWrong:
      `A hardcoded ${secretType} was found in ${file}. ` +
      "Secrets in source code can be extracted from version control history even after the file is deleted.",
    whyItMatters:
      "Exposed credentials can be used by attackers to gain unauthorized access to systems, " +
      "exfiltrate data, or escalate privileges. This is one of the most common root causes of breaches.",
    howToFix:
      "1. Rotate the exposed credential immediately\n" +
      "2. Move the value to an environment variable or a secrets manager (e.g., Azure Key Vault)\n" +
      "3. Add the file pattern to .gitignore to prevent future commits\n" +
      "4. Enable GitHub secret scanning push protection to block secrets before they reach the remote",
    estimatedEffort: "small",
    autoFixAvailable: false,
    references: [
      "https://docs.github.com/en/code-security/secret-scanning/about-secret-scanning",
      "https://docs.github.com/en/code-security/secret-scanning/push-protection-for-repositories-and-organizations",
      "https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/",
    ],
  };
}

function describeSecretPattern(finding: FindingInput, severity: FixDescription["severity"]): FixDescription {
  const patternType = finding.title || "secret pattern";
  const file = finding.file ?? "source code";
  return {
    findingId: `pattern-${Date.now()}`,
    findingType: "secret-pattern",
    severity,
    title: finding.title,
    whatIsWrong:
      `Our local repo scanner detected a ${patternType} in ${file}. ` +
      "This pattern matches known secret formats (API keys, tokens, connection strings) that should never be committed.",
    whyItMatters:
      "Even if the string is a test credential, its presence normalizes unsafe practices and " +
      "can confuse automated scanners, leading to alert fatigue for real incidents.",
    howToFix:
      "1. Verify whether the value is a real credential — if so, rotate immediately\n" +
      "2. Replace the value with an environment variable reference\n" +
      "3. If it is test data, use obviously fake placeholders (e.g., REPLACE_ME)\n" +
      "4. Update .copilotignore / .gitignore as appropriate",
    estimatedEffort: "small",
    autoFixAvailable: false,
    references: [
      "https://docs.github.com/en/code-security/secret-scanning/about-secret-scanning",
      "https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management_Testing/04-Review_Old_Backup_and_Unreferenced_Files_for_Sensitive_Information",
    ],
  };
}

function describeDependabot(finding: FindingInput, severity: FixDescription["severity"]): FixDescription {
  const pkg = finding.package ?? "unknown package";
  const cve = finding.cveId ?? "unspecified CVE";
  const desc = finding.description ?? "No additional details provided.";
  return {
    findingId: `dep-${Date.now()}`,
    findingType: "dependabot",
    severity,
    title: finding.title,
    whatIsWrong:
      `The dependency ${pkg} has a known vulnerability (${cve}). ${desc}`,
    whyItMatters:
      "Vulnerable dependencies are the #1 source of software supply-chain attacks. " +
      "Attackers actively scan public registries for projects using affected versions.",
    howToFix:
      `1. Update ${pkg} to the patched version\n` +
      "2. Run `npm audit fix` to apply automatic fixes\n" +
      "3. Test that the update doesn't break functionality\n" +
      "4. If breaking changes exist, pin to a safe version and plan migration",
    codeExample:
      `// Before:\n"${pkg}": "current"\n// After:\n"${pkg}": "patched"`,
    estimatedEffort: effortFromSeverity(severity),
    autoFixAvailable: true,
    references: [
      finding.cveId ? `https://nvd.nist.gov/vuln/detail/${finding.cveId}` : "https://nvd.nist.gov/",
      "https://docs.github.com/en/code-security/dependabot/dependabot-alerts/about-dependabot-alerts",
      "https://owasp.org/Top10/A06_2021-Vulnerable_and_Outdated_Components/",
    ],
  };
}

function describeCodeScanning(finding: FindingInput, severity: FixDescription["severity"]): FixDescription {
  const file = finding.file ?? "source code";
  const line = finding.line ? ` at line ${finding.line}` : "";
  const titleLower = finding.title.toLowerCase();

  let howToFix: string;
  let codeExample: string | undefined;

  if (titleLower.includes("sql") && titleLower.includes("inject")) {
    howToFix =
      "1. Replace string-concatenated SQL with parameterized queries\n" +
      "2. Use an ORM or query builder that escapes inputs automatically\n" +
      "3. Validate and sanitize all user-supplied values\n" +
      "4. Apply the principle of least privilege to database accounts";
    codeExample =
      '// Before (vulnerable):\ndb.query("SELECT * FROM users WHERE id = " + userId);\n\n' +
      '// After (safe):\ndb.query("SELECT * FROM users WHERE id = ?", [userId]);';
  } else if (titleLower.includes("xss") || titleLower.includes("cross-site scripting")) {
    howToFix =
      "1. Apply context-aware output encoding (HTML entity, JS, URL encoding)\n" +
      "2. Use a templating engine with auto-escaping enabled\n" +
      "3. Set Content-Security-Policy headers to restrict inline scripts\n" +
      "4. Validate input against an allowlist where possible";
    codeExample =
      "// Before (vulnerable):\nelement.innerHTML = userInput;\n\n" +
      "// After (safe):\nelement.textContent = userInput;";
  } else if (titleLower.includes("path traversal") || titleLower.includes("directory traversal")) {
    howToFix =
      "1. Canonicalize the path and verify it stays within the intended directory\n" +
      "2. Reject any input containing '..' sequences\n" +
      "3. Use a safe path-join utility that resolves symlinks\n" +
      "4. Run the process with minimal filesystem permissions";
  } else if (titleLower.includes("command injection") || titleLower.includes("os command")) {
    howToFix =
      "1. Avoid spawning shell commands with user input\n" +
      "2. If a command must be run, use an allowlist of commands and arguments\n" +
      "3. Use child_process.execFile (not exec) with an explicit argument array\n" +
      "4. Sanitize all inputs with a strict character allowlist";
  } else {
    howToFix =
      `1. Review the CodeQL alert details for ${finding.title}\n` +
      `2. Apply the recommended fix from the CodeQL documentation\n` +
      "3. Add unit tests to confirm the vulnerability is mitigated\n" +
      "4. Request a peer review of the security-critical change";
  }

  return {
    findingId: `codeql-${Date.now()}`,
    findingType: "code-scanning",
    severity,
    title: finding.title,
    whatIsWrong:
      `CodeQL detected a potential ${finding.title} in ${file}${line}. ` +
      (finding.description ?? "This pattern may allow an attacker to exploit the application."),
    whyItMatters:
      "Code-level vulnerabilities can be exploited remotely. Depending on the issue class, " +
      "attackers may gain data access, execute arbitrary code, or disrupt service availability.",
    howToFix,
    codeExample,
    estimatedEffort: "medium",
    autoFixAvailable: !titleLower.includes("secret"),
    references: [
      "https://codeql.github.com/codeql-query-help/",
      "https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning",
      "https://owasp.org/www-project-top-ten/",
    ],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a detailed, template-based fix description for a security finding.
 * No external AI API is required — templates are matched by finding type.
 */
export function generateFixDescription(finding: FindingInput): FixDescription {
  const severity = normalizeSeverity(finding.severity);
  const findingType = normalizeFindingType(finding.type);

  switch (findingType) {
    case "secret-scanning":
      return describeSecretScanning(finding, severity);
    case "secret-pattern":
      return describeSecretPattern(finding, severity);
    case "dependabot":
      return describeDependabot(finding, severity);
    case "code-scanning":
      return describeCodeScanning(finding, severity);
  }
}

/**
 * Create a remediation pull request on GitHub for the given finding.
 * Uses the existing GitHubClient for all GitHub interactions.
 */
export async function createRemediationPR(
  repo: string,
  finding: FixDescription,
  options?: { assignTo?: string; baseBranch?: string },
): Promise<RemediationResult> {
  const githubClient = new GitHubClient();
  const assignee = options?.assignTo ?? "copilot";
  const branchName = `remediation/${sanitizeForBranch(finding.findingId)}`;

  const pr: RemediationPR = {
    findingId: finding.findingId,
    repo,
    branchName,
    status: "creating",
    assignedTo: `@${assignee}`,
    createdAt: new Date().toISOString(),
  };

  try {
    // 1. Create the remediation branch
    const branchResult = await githubClient.createBranch(branchName);
    if (!branchResult.success) {
      pr.status = "failed";
      return { finding, pr, success: false, error: `Branch creation failed: ${branchResult.error}` };
    }

    // 2. Push a remediation commit (placeholder patch file describing the fix)
    const patchContent = buildPatchContent(finding);
    const encodedContent = Buffer.from(patchContent).toString("base64");

    const commitResult = await githubClient.pushFile(
      branchName,
      `docs/remediation/${finding.findingId}.md`,
      encodedContent,
      `fix: remediation plan for ${finding.findingType} — ${finding.title}`,
    );
    if (!commitResult.success) {
      pr.status = "failed";
      return { finding, pr, success: false, error: `Commit failed: ${commitResult.error}` };
    }

    // 3. Open the pull request
    const prTitle = `fix: Remediate ${finding.severity} ${finding.findingType} — ${finding.title}`;
    const prBody = buildPRBody(finding, assignee);

    const prResult = await githubClient.createPullRequest(prTitle, branchName, prBody);
    if (!prResult.success) {
      pr.status = "failed";
      return { finding, pr, success: false, error: `PR creation failed: ${prResult.error}` };
    }

    const prData = prResult.data as PullRequestSummary;
    pr.prNumber = prData.number;
    pr.prUrl = prData.htmlUrl;
    pr.status = prData.alreadyExisted ? "open" : "open";

    return { finding, pr, success: true };
  } catch (error: unknown) {
    pr.status = "failed";
    const message = error instanceof Error ? error.message : "Unknown error during PR creation";
    return { finding, pr, success: false, error: message };
  }
}

/**
 * Fetch the current status of a remediation PR.
 */
export async function getRemediationStatus(repo: string, prNumber: number): Promise<RemediationPR> {
  const githubClient = new GitHubClient();
  const head = `remediation/`;

  // List open PRs to find the one matching the prNumber
  const prs = await githubClient.listOpenPullRequestsByHead(head);
  const match = prs.data?.find((p) => p.number === prNumber);

  const now = new Date().toISOString();

  if (!match) {
    return {
      findingId: "unknown",
      repo,
      prNumber,
      branchName: "unknown",
      status: "merged",
      assignedTo: "@copilot",
      createdAt: now,
      mergedAt: now,
    };
  }

  let status: RemediationPR["status"] = "open";
  if (match.state === "closed") {
    status = "merged";
  }

  return {
    findingId: match.head ?? "unknown",
    repo,
    prNumber: match.number,
    prUrl: match.htmlUrl,
    branchName: match.head ?? "unknown",
    status,
    assignedTo: "@copilot",
    createdAt: now,
  };
}

// ---------------------------------------------------------------------------
// Internal content builders
// ---------------------------------------------------------------------------

function buildPatchContent(finding: FixDescription): string {
  const lines = [
    `# Remediation: ${finding.title}`,
    "",
    `**Finding ID:** ${finding.findingId}`,
    `**Type:** ${finding.findingType}`,
    `**Severity:** ${finding.severity}`,
    `**Estimated Effort:** ${finding.estimatedEffort}`,
    `**Auto-fix Available:** ${finding.autoFixAvailable ? "Yes" : "No"}`,
    "",
    "## What Is Wrong",
    "",
    finding.whatIsWrong,
    "",
    "## Why It Matters",
    "",
    finding.whyItMatters,
    "",
    "## How to Fix",
    "",
    finding.howToFix,
    "",
  ];

  if (finding.codeExample) {
    lines.push("## Code Example", "", "```", finding.codeExample, "```", "");
  }

  if (finding.references.length > 0) {
    lines.push("## References", "");
    for (const ref of finding.references) {
      lines.push(`- ${ref}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function buildPRBody(finding: FixDescription, assignee: string): string {
  const sections = [
    `## 🔒 Security Remediation`,
    "",
    `| Field | Value |`,
    `|-------|-------|`,
    `| **Finding** | ${finding.findingId} |`,
    `| **Type** | \`${finding.findingType}\` |`,
    `| **Severity** | **${finding.severity.toUpperCase()}** |`,
    `| **Effort** | ${finding.estimatedEffort} |`,
    `| **Assigned to** | @${assignee} |`,
    "",
    "### What Is Wrong",
    "",
    finding.whatIsWrong,
    "",
    "### Why It Matters",
    "",
    finding.whyItMatters,
    "",
    "### How to Fix",
    "",
    finding.howToFix,
    "",
  ];

  if (finding.codeExample) {
    sections.push("### Code Example", "", "```diff", finding.codeExample, "```", "");
  }

  if (finding.references.length > 0) {
    sections.push("### References", "");
    for (const ref of finding.references) {
      sections.push(`- [${ref}](${ref})`);
    }
    sections.push("");
  }

  sections.push(
    "---",
    "",
    `> Labels: \`security\`, \`auto-remediation\`, \`${finding.severity}\``,
    "",
    "_This PR was generated automatically by the auto-fix service._",
  );

  return sections.join("\n");
}
