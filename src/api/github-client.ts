import dotenv from "dotenv";
import { Octokit } from "@octokit/rest";

dotenv.config();

export interface GitHubResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  status?: number;
}

export interface BranchReference {
  branchName: string;
  sha: string;
  created: boolean;
}

export interface BranchDeletionResult {
  branchName: string;
  deleted: boolean;
}

export interface FileCommitResult {
  path: string;
  sha?: string;
  url?: string;
}

export interface WorkflowDispatchResult {
  workflowFile: string;
  branchName: string;
  triggered: boolean;
}

export interface WorkflowRunSummary {
  id: number;
  name?: string;
  workflowId?: number;
  status?: string | null;
  conclusion?: string | null;
  htmlUrl?: string;
  headBranch?: string | null;
  path?: string | null;
  event?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkflowRunLogsResult {
  runId: number;
  downloadUrl?: string;
  content?: string;
}

export interface SecretScanningAlertSummary {
  number: number;
  state?: string;
  secretType?: string;
  resolution?: string | null;
  htmlUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  ref?: string | null;
}

export interface CodeScanningAlertSummary {
  number: number;
  state?: string;
  ruleId?: string;
  htmlUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  ref?: string | null;
}

export interface PullRequestSummary {
  number: number;
  htmlUrl?: string;
  state?: string;
  head?: string;
  base?: string;
  alreadyExisted?: boolean;
}

export interface CloseIssuesResult {
  label: string;
  closedIssueNumbers: number[];
}

export interface DeleteWorkflowRunsResult {
  branchName: string;
  deletedRunIds: number[];
  failedRunIds: number[];
}

export interface ClosePullRequestsResult {
  head: string;
  closedPullRequestNumbers: number[];
}

interface GitHubErrorShape {
  status?: number;
  message?: string;
  response?: {
    data?: {
      message?: string;
    };
  };
}

function extractErrorDetails(error: unknown): { message: string; status?: number } {
  if (error instanceof Error) {
    const githubError = error as Error & GitHubErrorShape;
    return {
      message: githubError.response?.data?.message ?? githubError.message,
      status: githubError.status,
    };
  }

  return {
    message: "Unknown GitHub API error",
  };
}

function matchesWorkflowFile(run: WorkflowRunSummary, workflowFile: string): boolean {
  const normalizedWorkflowFile = workflowFile.toLowerCase();
  const normalizedPath = run.path?.toLowerCase();

  return Boolean(
    normalizedPath?.endsWith(normalizedWorkflowFile) ||
      normalizedPath?.includes(normalizedWorkflowFile),
  );
}

export class GitHubClient {
  private readonly octokit?: Octokit;
  private readonly owner: string;
  private readonly repo: string;
  private readonly baseBranch: string;
  private readonly configurationError?: string;

  constructor() {
    this.owner = process.env.GITHUB_OWNER ?? "sautalwar";
    this.repo = process.env.GITHUB_REPO ?? "ghcopilot-pii-demo";
    this.baseBranch = process.env.GITHUB_BASE_BRANCH ?? "main";

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      this.configurationError = "GITHUB_TOKEN is not configured. Add it to your .env file to enable GitHub orchestration.";
      return;
    }

    this.octokit = new Octokit({ auth: token });
  }

  private repoParams(): { owner: string; repo: string } {
    return {
      owner: this.owner,
      repo: this.repo,
    };
  }

  private configurationFailure<T>(): GitHubResult<T> {
    return {
      success: false,
      error: this.configurationError ?? "GitHub client is not configured.",
    };
  }

  private mapWorkflowRun(run: any): WorkflowRunSummary {
    return {
      id: run.id,
      name: run.name ?? run.display_title,
      workflowId: run.workflow_id,
      status: run.status,
      conclusion: run.conclusion,
      htmlUrl: run.html_url,
      headBranch: run.head_branch,
      path: run.path ?? null,
      event: run.event ?? null,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
    };
  }

  private mapPullRequest(pullRequest: any): PullRequestSummary {
    return {
      number: pullRequest.number,
      htmlUrl: pullRequest.html_url,
      state: pullRequest.state,
      head: pullRequest.head?.ref,
      base: pullRequest.base?.ref,
    };
  }

  private async getBranchSha(branchName: string): Promise<GitHubResult<string>> {
    if (!this.octokit) {
      return this.configurationFailure();
    }

    try {
      const response = await this.octokit.git.getRef({
        ...this.repoParams(),
        ref: `heads/${branchName}`,
      });

      return {
        success: true,
        data: response.data.object.sha,
      };
    } catch (error: unknown) {
      const details = extractErrorDetails(error);
      return {
        success: false,
        error: details.message,
        status: details.status,
      };
    }
  }

  private async getFileSha(filePath: string, branchName: string): Promise<string | undefined> {
    if (!this.octokit) {
      return undefined;
    }

    try {
      const response = await this.octokit.repos.getContent({
        ...this.repoParams(),
        path: filePath,
        ref: branchName,
      });

      if (Array.isArray(response.data)) {
        return undefined;
      }

      return response.data.sha;
    } catch {
      return undefined;
    }
  }

  async branchExists(branchName: string): Promise<GitHubResult<boolean>> {
    if (!this.octokit) {
      return this.configurationFailure();
    }

    try {
      await this.octokit.git.getRef({
        ...this.repoParams(),
        ref: `heads/${branchName}`,
      });

      return {
        success: true,
        data: true,
      };
    } catch (error: unknown) {
      const details = extractErrorDetails(error);
      if (details.status === 404) {
        return {
          success: true,
          data: false,
        };
      }

      return {
        success: false,
        error: details.message,
        status: details.status,
      };
    }
  }

  async createBranch(branchName: string): Promise<GitHubResult<BranchReference>> {
    if (!this.octokit) {
      return this.configurationFailure();
    }

    const existingBranch = await this.getBranchSha(branchName);
    if (existingBranch.success && existingBranch.data) {
      return {
        success: true,
        data: {
          branchName,
          sha: existingBranch.data,
          created: false,
        },
      };
    }

    if (!existingBranch.success && existingBranch.status !== 404) {
      return {
        success: false,
        error: existingBranch.error,
        status: existingBranch.status,
      };
    }

    const baseBranch = await this.getBranchSha(this.baseBranch);
    if (!baseBranch.success || !baseBranch.data) {
      return {
        success: false,
        error: baseBranch.error ?? `Unable to resolve base branch ${this.baseBranch}`,
        status: baseBranch.status,
      };
    }

    try {
      const response = await this.octokit.git.createRef({
        ...this.repoParams(),
        ref: `refs/heads/${branchName}`,
        sha: baseBranch.data,
      });

      return {
        success: true,
        data: {
          branchName,
          sha: response.data.object.sha,
          created: true,
        },
      };
    } catch (error: unknown) {
      const details = extractErrorDetails(error);
      return {
        success: false,
        error: details.message,
        status: details.status,
      };
    }
  }

  async pushFile(branchName: string, filePath: string, content: string, message: string): Promise<GitHubResult<FileCommitResult>> {
    if (!this.octokit) {
      return this.configurationFailure();
    }

    try {
      const sha = await this.getFileSha(filePath, branchName);
      const response = await this.octokit.repos.createOrUpdateFileContents({
        ...this.repoParams(),
        path: filePath,
        message,
        content,
        branch: branchName,
        sha,
      });

      return {
        success: true,
        data: {
          path: response.data.content?.path ?? filePath,
          sha: response.data.commit.sha,
          url: response.data.commit.html_url,
        },
      };
    } catch (error: unknown) {
      const details = extractErrorDetails(error);
      return {
        success: false,
        error: details.message,
        status: details.status,
      };
    }
  }

  async triggerWorkflow(workflowFile: string, branchName: string, inputs: Record<string, string> = {}): Promise<GitHubResult<WorkflowDispatchResult>> {
    if (!this.octokit) {
      return this.configurationFailure();
    }

    try {
      await this.octokit.actions.createWorkflowDispatch({
        ...this.repoParams(),
        workflow_id: workflowFile,
        ref: branchName,
        inputs,
      });

      return {
        success: true,
        data: {
          workflowFile,
          branchName,
          triggered: true,
        },
      };
    } catch (error: unknown) {
      const details = extractErrorDetails(error);
      return {
        success: false,
        error: details.message,
        status: details.status,
      };
    }
  }

  async getWorkflowRuns(branchName?: string): Promise<GitHubResult<WorkflowRunSummary[]>> {
    if (!this.octokit) {
      return this.configurationFailure();
    }

    try {
      const response = await this.octokit.actions.listWorkflowRunsForRepo({
        ...this.repoParams(),
        ...(branchName ? { branch: branchName } : {}),
        per_page: 25,
      });

      return {
        success: true,
        data: response.data.workflow_runs.map((run) => this.mapWorkflowRun(run)),
      };
    } catch (error: unknown) {
      const details = extractErrorDetails(error);
      return {
        success: false,
        error: details.message,
        status: details.status,
      };
    }
  }

  async getWorkflowRunStatus(runId: number): Promise<GitHubResult<WorkflowRunSummary>> {
    if (!this.octokit) {
      return this.configurationFailure();
    }

    try {
      const response = await this.octokit.actions.getWorkflowRun({
        ...this.repoParams(),
        run_id: runId,
      });

      return {
        success: true,
        data: this.mapWorkflowRun(response.data),
      };
    } catch (error: unknown) {
      const details = extractErrorDetails(error);
      return {
        success: false,
        error: details.message,
        status: details.status,
      };
    }
  }

  async getWorkflowRunLogs(runId: number): Promise<GitHubResult<WorkflowRunLogsResult>> {
    if (!this.octokit) {
      return this.configurationFailure();
    }

    try {
      const response = await this.octokit.request("GET /repos/{owner}/{repo}/actions/runs/{run_id}/logs", {
        ...this.repoParams(),
        run_id: runId,
        request: {
          redirect: "manual" as never,
        },
      });

      const headers = response.headers as Record<string, string | string[] | undefined>;
      const locationHeader = Array.isArray(headers.location) ? headers.location[0] : headers.location;
      const data = response.data as unknown;

      let content: string | undefined;
      if (typeof data === "string") {
        content = data;
      } else if (data instanceof ArrayBuffer) {
        content = Buffer.from(data).toString("base64");
      } else if (Buffer.isBuffer(data)) {
        content = data.toString("base64");
      }

      return {
        success: true,
        data: {
          runId,
          downloadUrl: locationHeader,
          content,
        },
      };
    } catch (error: unknown) {
      const details = extractErrorDetails(error);
      return {
        success: false,
        error: details.message,
        status: details.status,
      };
    }
  }

  async getSecretScanningAlerts(): Promise<GitHubResult<SecretScanningAlertSummary[]>> {
    if (!this.octokit) {
      return this.configurationFailure();
    }

    try {
      const response = await this.octokit.secretScanning.listAlertsForRepo({
        ...this.repoParams(),
        state: "open",
        per_page: 100,
      });

      return {
        success: true,
        data: response.data.map((alert: any) => ({
          number: alert.number,
          state: alert.state,
          secretType: alert.secret_type,
          resolution: alert.resolution ?? null,
          htmlUrl: alert.html_url,
          createdAt: alert.created_at,
          updatedAt: alert.updated_at,
          ref: alert.most_recent_instance?.ref ?? null,
        })),
      };
    } catch (error: unknown) {
      const details = extractErrorDetails(error);
      return {
        success: false,
        error: details.message,
        status: details.status,
      };
    }
  }

  async getCodeScanningAlerts(): Promise<GitHubResult<CodeScanningAlertSummary[]>> {
    if (!this.octokit) {
      return this.configurationFailure();
    }

    try {
      const response = await this.octokit.codeScanning.listAlertsForRepo({
        ...this.repoParams(),
        state: "open",
        per_page: 100,
      });

      return {
        success: true,
        data: response.data.map((alert: any) => ({
          number: alert.number,
          state: alert.state,
          ruleId: alert.rule?.id,
          htmlUrl: alert.html_url,
          createdAt: alert.created_at,
          updatedAt: alert.updated_at,
          ref: alert.most_recent_instance?.ref ?? null,
        })),
      };
    } catch (error: unknown) {
      const details = extractErrorDetails(error);
      return {
        success: false,
        error: details.message,
        status: details.status,
      };
    }
  }

  async listOpenPullRequestsByHead(head: string): Promise<GitHubResult<PullRequestSummary[]>> {
    if (!this.octokit) {
      return this.configurationFailure();
    }

    try {
      const response = await this.octokit.pulls.list({
        ...this.repoParams(),
        state: "open",
        head: `${this.owner}:${head}`,
        per_page: 25,
      });

      return {
        success: true,
        data: response.data.map((pullRequest) => this.mapPullRequest(pullRequest)),
      };
    } catch (error: unknown) {
      const details = extractErrorDetails(error);
      return {
        success: false,
        error: details.message,
        status: details.status,
      };
    }
  }

  async createPullRequest(title: string, head: string, body: string): Promise<GitHubResult<PullRequestSummary>> {
    if (!this.octokit) {
      return this.configurationFailure();
    }

    try {
      const response = await this.octokit.pulls.create({
        ...this.repoParams(),
        title,
        head,
        base: this.baseBranch,
        body,
      });

      return {
        success: true,
        data: this.mapPullRequest(response.data),
      };
    } catch (error: unknown) {
      const details = extractErrorDetails(error);
      if (details.status === 422) {
        const existingPullRequests = await this.listOpenPullRequestsByHead(head);
        if (existingPullRequests.success && existingPullRequests.data && existingPullRequests.data.length > 0) {
          return {
            success: true,
            data: {
              ...existingPullRequests.data[0],
              alreadyExisted: true,
            },
          };
        }
      }

      return {
        success: false,
        error: details.message,
        status: details.status,
      };
    }
  }

  async deleteBranch(branchName: string): Promise<GitHubResult<BranchDeletionResult>> {
    if (!this.octokit) {
      return this.configurationFailure();
    }

    try {
      await this.octokit.git.deleteRef({
        ...this.repoParams(),
        ref: `heads/${branchName}`,
      });

      return {
        success: true,
        data: {
          branchName,
          deleted: true,
        },
      };
    } catch (error: unknown) {
      const details = extractErrorDetails(error);
      if (details.status === 404) {
        return {
          success: true,
          data: {
            branchName,
            deleted: false,
          },
        };
      }

      return {
        success: false,
        error: details.message,
        status: details.status,
      };
    }
  }

  async closeIssuesByLabel(label: string): Promise<GitHubResult<CloseIssuesResult>> {
    if (!this.octokit) {
      return this.configurationFailure();
    }

    try {
      const response = await this.octokit.issues.listForRepo({
        ...this.repoParams(),
        state: "open",
        labels: label,
        per_page: 100,
      });

      const issuesToClose = response.data.filter((issue) => !issue.pull_request);
      const closedIssueNumbers: number[] = [];

      for (const issue of issuesToClose) {
        await this.octokit.issues.update({
          ...this.repoParams(),
          issue_number: issue.number,
          state: "closed",
        });
        closedIssueNumbers.push(issue.number);
      }

      return {
        success: true,
        data: {
          label,
          closedIssueNumbers,
        },
      };
    } catch (error: unknown) {
      const details = extractErrorDetails(error);
      return {
        success: false,
        error: details.message,
        status: details.status,
      };
    }
  }

  async closePullRequestsByHead(head: string): Promise<GitHubResult<ClosePullRequestsResult>> {
    if (!this.octokit) {
      return this.configurationFailure();
    }

    const pullRequests = await this.listOpenPullRequestsByHead(head);
    if (!pullRequests.success) {
      return {
        success: false,
        error: pullRequests.error,
        status: pullRequests.status,
      };
    }

    const closedPullRequestNumbers: number[] = [];

    try {
      for (const pullRequest of pullRequests.data ?? []) {
        await this.octokit.pulls.update({
          ...this.repoParams(),
          pull_number: pullRequest.number,
          state: "closed",
        });
        closedPullRequestNumbers.push(pullRequest.number);
      }

      return {
        success: true,
        data: {
          head,
          closedPullRequestNumbers,
        },
      };
    } catch (error: unknown) {
      const details = extractErrorDetails(error);
      return {
        success: false,
        error: details.message,
        status: details.status,
      };
    }
  }

  async deleteWorkflowRuns(branchName: string, workflowFile?: string): Promise<GitHubResult<DeleteWorkflowRunsResult>> {
    if (!this.octokit) {
      return this.configurationFailure();
    }

    const workflowRuns = await this.getWorkflowRuns(branchName);
    if (!workflowRuns.success) {
      return {
        success: false,
        error: workflowRuns.error,
        status: workflowRuns.status,
      };
    }

    const runsToDelete = workflowFile
      ? (workflowRuns.data ?? []).filter((run) => matchesWorkflowFile(run, workflowFile))
      : workflowRuns.data ?? [];
    const deletedRunIds: number[] = [];
    const failedRunIds: number[] = [];

    for (const run of runsToDelete) {
      try {
        await this.octokit.actions.deleteWorkflowRun({
          ...this.repoParams(),
          run_id: run.id,
        });
        deletedRunIds.push(run.id);
      } catch {
        failedRunIds.push(run.id);
      }
    }

    return {
      success: failedRunIds.length === 0,
      data: {
        branchName,
        deletedRunIds,
        failedRunIds,
      },
      error: failedRunIds.length > 0 ? `Unable to delete workflow runs: ${failedRunIds.join(", ")}` : undefined,
    };
  }
}

export const githubClient = new GitHubClient();
