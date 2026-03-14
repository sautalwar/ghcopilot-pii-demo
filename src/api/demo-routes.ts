import { Router, type Request, type Response } from "express";

import { demoScenarios, getDemoScenario, type DemoScenario } from "./demo-definitions";
import {
  githubClient,
  type BranchDeletionResult,
  type CodeScanningAlertSummary,
  type CloseIssuesResult,
  type ClosePullRequestsResult,
  type DeleteWorkflowRunsResult,
  type FileCommitResult,
  type PullRequestSummary,
  type SecretScanningAlertSummary,
  type WorkflowRunSummary,
} from "./github-client";

const router = Router();

interface DemoStatusPayload {
  id: string;
  name: string;
  description: string;
  category: DemoScenario["category"];
  branchName: string;
  workflowFile: string;
  branchExists: boolean;
  workflow: {
    runId?: number;
    status: string;
    conclusion?: string | null;
    url?: string;
    createdAt?: string;
  };
  alerts: {
    secretScanning: number;
    codeScanning: number;
    total: number;
  };
  openPullRequests: number;
  errors: string[];
}

interface FilePushSummary {
  path: string;
  success: boolean;
  details?: FileCommitResult;
  error?: string;
}

interface TeardownResult {
  demoId: string;
  branch: BranchDeletionResult | null;
  pullRequests: ClosePullRequestsResult | null;
  issues: CloseIssuesResult | null;
  workflowRuns: DeleteWorkflowRunsResult | null;
  errors: string[];
}

function matchesWorkflow(run: WorkflowRunSummary, workflowFile: string): boolean {
  const normalizedWorkflowFile = workflowFile.toLowerCase();
  const normalizedPath = run.path?.toLowerCase();

  return Boolean(
    normalizedPath?.endsWith(normalizedWorkflowFile) ||
      normalizedPath?.includes(normalizedWorkflowFile),
  );
}

function collectAlertCount<T extends SecretScanningAlertSummary | CodeScanningAlertSummary>(alerts: T[] | undefined, branchName: string): number {
  if (!alerts || alerts.length === 0) {
    return 0;
  }

  const branchRef = `refs/heads/${branchName}`;
  const branchScopedAlerts = alerts.filter((alert) => !alert.ref || alert.ref === branchRef);
  return branchScopedAlerts.length;
}

async function buildDemoStatus(
  demo: DemoScenario,
  sharedAlerts?: {
    secretAlerts?: SecretScanningAlertSummary[];
    codeAlerts?: CodeScanningAlertSummary[];
    errors?: string[];
  },
): Promise<DemoStatusPayload> {
  const errors = [...(sharedAlerts?.errors ?? [])];

  const [branchExistsResult, workflowRunsResult, pullRequestsResult] = await Promise.all([
    githubClient.branchExists(demo.branchName),
    githubClient.getWorkflowRuns(demo.branchName),
    githubClient.listOpenPullRequestsByHead(demo.branchName),
  ]);

  const branchExists = branchExistsResult.success ? branchExistsResult.data ?? false : false;
  if (!branchExistsResult.success && branchExistsResult.error) {
    errors.push(branchExistsResult.error);
  }

  const workflowRuns = workflowRunsResult.success ? workflowRunsResult.data ?? [] : [];
  if (!workflowRunsResult.success && workflowRunsResult.error) {
    errors.push(workflowRunsResult.error);
  }

  const latestRun = workflowRuns.find((run) => matchesWorkflow(run, demo.workflowFile)) ?? workflowRuns[0];
  const workflowStatus = latestRun?.status ?? (branchExists ? "ready" : "not-started");

  const openPullRequests = pullRequestsResult.success ? pullRequestsResult.data?.length ?? 0 : 0;
  if (!pullRequestsResult.success && pullRequestsResult.error) {
    errors.push(pullRequestsResult.error);
  }

  const secretScanning = collectAlertCount(sharedAlerts?.secretAlerts, demo.branchName);
  const codeScanning = collectAlertCount(sharedAlerts?.codeAlerts, demo.branchName);

  return {
    id: demo.id,
    name: demo.name,
    description: demo.description,
    category: demo.category,
    branchName: demo.branchName,
    workflowFile: demo.workflowFile,
    branchExists,
    workflow: {
      runId: latestRun?.id,
      status: workflowStatus,
      conclusion: latestRun?.conclusion,
      url: latestRun?.htmlUrl,
      createdAt: latestRun?.createdAt,
    },
    alerts: {
      secretScanning,
      codeScanning,
      total: secretScanning + codeScanning,
    },
    openPullRequests,
    errors,
  };
}

async function loadSharedAlerts(): Promise<{
  secretAlerts?: SecretScanningAlertSummary[];
  codeAlerts?: CodeScanningAlertSummary[];
  errors: string[];
}> {
  const [secretAlertsResult, codeAlertsResult] = await Promise.all([
    githubClient.getSecretScanningAlerts(),
    githubClient.getCodeScanningAlerts(),
  ]);

  const errors: string[] = [];
  if (!secretAlertsResult.success && secretAlertsResult.error) {
    errors.push(secretAlertsResult.error);
  }
  if (!codeAlertsResult.success && codeAlertsResult.error) {
    errors.push(codeAlertsResult.error);
  }

  return {
    secretAlerts: secretAlertsResult.data,
    codeAlerts: codeAlertsResult.data,
    errors,
  };
}

function resolveDemo(demoId: string): DemoScenario | undefined {
  return getDemoScenario(demoId);
}

function respondMissingDemo(response: Response, demoId: string): Response {
  return response.status(404).json({
    success: false,
    error: `Unknown demo '${demoId}'.`,
  });
}

async function pushScenarioFiles(branchName: string, files: DemoScenario["incidentFiles"], commitPrefix: string): Promise<FilePushSummary[]> {
  const results: FilePushSummary[] = [];

  for (const file of files) {
    const pushResult = await githubClient.pushFile(
      branchName,
      file.path,
      file.contentFile,
      `${commitPrefix}: ${file.path}`,
    );

    results.push({
      path: file.path,
      success: pushResult.success,
      details: pushResult.data,
      error: pushResult.error,
    });

    if (!pushResult.success) {
      break;
    }
  }

  return results;
}

function operationSucceeded(results: Array<{ success?: boolean }>): boolean {
  return results.every((result) => result.success !== false);
}

async function teardownDemo(demo: DemoScenario): Promise<TeardownResult> {
  const [pullRequestsResult, issuesResult, workflowRunsResult, branchResult] = await Promise.all([
    githubClient.closePullRequestsByHead(demo.branchName),
    githubClient.closeIssuesByLabel(`demo:${demo.id}`),
    githubClient.deleteWorkflowRuns(demo.branchName),
    githubClient.deleteBranch(demo.branchName),
  ]);

  const errors = [
    pullRequestsResult.error,
    issuesResult.error,
    workflowRunsResult.error,
    branchResult.error,
  ].filter((value): value is string => Boolean(value));

  return {
    demoId: demo.id,
    branch: branchResult.data ?? null,
    pullRequests: pullRequestsResult.data ?? null,
    issues: issuesResult.data ?? null,
    workflowRuns: workflowRunsResult.data ?? null,
    errors,
  };
}

async function getLatestRunForDemo(demo: DemoScenario): Promise<{ run?: WorkflowRunSummary; error?: string }> {
  const workflowRuns = await githubClient.getWorkflowRuns(demo.branchName);
  if (!workflowRuns.success) {
    return {
      error: workflowRuns.error ?? "Unable to retrieve workflow runs.",
    };
  }

  const run = workflowRuns.data?.find((candidate) => matchesWorkflow(candidate, demo.workflowFile)) ?? workflowRuns.data?.[0];
  return { run };
}

router.get("/", async (_request: Request, response: Response) => {
  const sharedAlerts = await loadSharedAlerts();
  const demos = await Promise.all(demoScenarios.map((demo) => buildDemoStatus(demo, sharedAlerts)));

  response.json({
    success: true,
    demos,
  });
});

router.post("/teardown-all", async (_request: Request, response: Response) => {
  const results: TeardownResult[] = [];

  for (const demo of demoScenarios) {
    results.push(await teardownDemo(demo));
  }

  const success = results.every((result) => result.errors.length === 0);
  response.status(success ? 200 : 207).json({
    success,
    results,
  });
});

router.post("/:demoId/start", async (request: Request, response: Response) => {
  const demo = resolveDemo(request.params.demoId);
  if (!demo) {
    return respondMissingDemo(response, request.params.demoId);
  }

  const branchResult = await githubClient.createBranch(demo.branchName);
  if (!branchResult.success) {
    return response.status(502).json({
      success: false,
      error: branchResult.error ?? "Unable to create demo branch.",
    });
  }

  const pushedFiles = await pushScenarioFiles(demo.branchName, demo.incidentFiles, `demo(${demo.id}) incident`);
  if (!operationSucceeded(pushedFiles)) {
    return response.status(502).json({
      success: false,
      error: "Unable to push incident files for the selected demo.",
      branch: branchResult.data,
      pushedFiles,
    });
  }

  const workflowResult = await githubClient.triggerWorkflow(
    demo.workflowFile,
    demo.branchName,
    demo.workflowInputs,
  );

  const status = await buildDemoStatus(demo, await loadSharedAlerts());
  return response.status(workflowResult.success ? 202 : 502).json({
    success: workflowResult.success,
    branch: branchResult.data,
    pushedFiles,
    workflow: workflowResult.data,
    workflowError: workflowResult.error,
    status,
  });
});

router.get("/:demoId/status", async (request: Request, response: Response) => {
  const demo = resolveDemo(request.params.demoId);
  if (!demo) {
    return respondMissingDemo(response, request.params.demoId);
  }

  const status = await buildDemoStatus(demo, await loadSharedAlerts());
  response.json({
    success: true,
    status,
  });
});

router.post("/:demoId/remediate", async (request: Request, response: Response) => {
  const demo = resolveDemo(request.params.demoId);
  if (!demo) {
    return respondMissingDemo(response, request.params.demoId);
  }

  const branchResult = await githubClient.createBranch(demo.branchName);
  if (!branchResult.success) {
    return response.status(502).json({
      success: false,
      error: branchResult.error ?? "Unable to create or resolve the remediation branch.",
    });
  }

  const pushedFiles = await pushScenarioFiles(demo.branchName, demo.remediationFiles, `demo(${demo.id}) remediation`);
  if (!operationSucceeded(pushedFiles)) {
    return response.status(502).json({
      success: false,
      error: "Unable to push remediation files for the selected demo.",
      branch: branchResult.data,
      pushedFiles,
    });
  }

  const pullRequestBody = [
    `Automated remediation for the ${demo.name} live demo.`,
    "",
    `- Demo ID: ${demo.id}`,
    `- Branch: ${demo.branchName}`,
    `- Workflow: ${demo.workflowFile}`,
    `- Tracking label: demo:${demo.id}`,
  ].join("\n");

  const pullRequestResult = await githubClient.createPullRequest(
    `Remediate ${demo.name}`,
    demo.branchName,
    pullRequestBody,
  );

  const status = await buildDemoStatus(demo, await loadSharedAlerts());
  return response.status(pullRequestResult.success ? 200 : 502).json({
    success: pullRequestResult.success,
    branch: branchResult.data,
    pushedFiles,
    pullRequest: pullRequestResult.data,
    pullRequestError: pullRequestResult.error,
    status,
  });
});

router.post("/:demoId/teardown", async (request: Request, response: Response) => {
  const demo = resolveDemo(request.params.demoId);
  if (!demo) {
    return respondMissingDemo(response, request.params.demoId);
  }

  const result = await teardownDemo(demo);
  response.status(result.errors.length === 0 ? 200 : 207).json({
    success: result.errors.length === 0,
    result,
  });
});

router.get("/:demoId/logs", async (request: Request, response: Response) => {
  const demo = resolveDemo(request.params.demoId);
  if (!demo) {
    return respondMissingDemo(response, request.params.demoId);
  }

  const latestRunResult = await getLatestRunForDemo(demo);
  if (latestRunResult.error) {
    return response.status(502).json({
      success: false,
      error: latestRunResult.error,
    });
  }

  if (!latestRunResult.run) {
    return response.status(404).json({
      success: false,
      error: `No workflow runs found for demo '${demo.id}'.`,
    });
  }

  const latestRunStatus = await githubClient.getWorkflowRunStatus(latestRunResult.run.id);
  const logsResult = await githubClient.getWorkflowRunLogs(latestRunResult.run.id);
  if (!logsResult.success) {
    return response.status(502).json({
      success: false,
      error: logsResult.error ?? "Unable to retrieve workflow logs.",
      run: latestRunStatus.data ?? latestRunResult.run,
    });
  }

  response.json({
    success: true,
    run: latestRunStatus.data ?? latestRunResult.run,
    logs: logsResult.data,
  });
});

export default router;
