import { Router, type Request, type Response } from 'express';
import { createJiraClient } from '../mcp-server/jira-client';
import { checkForDuplicate, type GHASFinding } from '../mcp-server/dedup-service';
import { optionalAuth, requirePermission } from '../middleware/rbac';

const router = Router();
const jira = createJiraClient();

// TODO: Make auth required in production
router.use(optionalAuth);

// GET /api/jira/tickets — list all tracked Jira tickets
router.get('/tickets', requirePermission('jira:read'), async (_req: Request, res: Response) => {
  try {
    const result = await jira.searchIssues(`project = ${process.env.JIRA_PROJECT_KEY || 'VULN'} ORDER BY created DESC`);
    res.json({ success: true, data: result.issues, meta: { total: result.total } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/jira/tickets/:key — get specific ticket details
router.get('/tickets/:key', requirePermission('jira:read'), async (req: Request, res: Response) => {
  try {
    const issue = await jira.getIssue(req.params.key);
    if (!issue) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: issue });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/jira/search — run a JQL search
router.post('/search', requirePermission('jira:read'), async (req: Request, res: Response) => {
  try {
    const { jql } = req.body;
    if (!jql) return res.status(400).json({ success: false, error: 'jql is required' });
    const result = await jira.searchIssues(jql);
    res.json({ success: true, data: result.issues, meta: { total: result.total } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/jira/bridge — manually trigger the bridge (CVE → Jira with dedup)
router.post('/bridge', requirePermission('jira:create'), async (req: Request, res: Response) => {
  try {
    const { alertType, cveId, packageName, filePath, severity, summary: userSummary } = req.body;
    const type = alertType || 'dependabot';

    const finding: GHASFinding = {
      type,
      cveId,
      packageName,
      filePath,
      ruleId: cveId,
    };

    const dupCheck = await checkForDuplicate(finding, jira);

    if (dupCheck.found && dupCheck.issueKey) {
      await jira.addComment(dupCheck.issueKey, `Additional finding: ${cveId || packageName || filePath} (severity: ${severity || 'unknown'})`);
      return res.json({
        success: true,
        data: { action: 'comment_added', issueKey: dupCheck.issueKey, confidence: dupCheck.confidence },
        meta: { deduplicated: true },
      });
    }

    const summaryText = userSummary || `[${(severity || 'MEDIUM').toUpperCase()}] ${type}: ${cveId || packageName || filePath}`;
    const description = [
      `Alert type: ${type}`,
      cveId ? `CVE: ${cveId}` : null,
      packageName ? `Package: ${packageName}` : null,
      filePath ? `File: ${filePath}` : null,
      severity ? `Severity: ${severity}` : null,
    ].filter(Boolean).join('\n');

    const issue = await jira.createIssue({
      summary: summaryText,
      description,
      priority: severity === 'CRITICAL' ? 'Highest' : severity === 'HIGH' ? 'High' : 'Medium',
      labels: ['ghas', 'security', type],
    });

    res.json({
      success: true,
      data: { action: 'created', issue },
      meta: { deduplicated: false },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/jira/stats — dashboard stats
router.get('/stats', requirePermission('jira:read'), async (_req: Request, res: Response) => {
  try {
    const projectKey = process.env.JIRA_PROJECT_KEY || 'VULN';
    const result = await jira.searchIssues(`project = ${projectKey}`);
    const issues = result.issues;
    const open = issues.filter(i => i.status === 'Open' || i.status === 'To Do');
    const inProgress = issues.filter(i => i.status === 'In Progress');
    const done = issues.filter(i => i.status === 'Done' || i.status === 'Closed');
    res.json({
      success: true,
      data: { total: issues.length, open: open.length, inProgress: inProgress.length, done: done.length },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
