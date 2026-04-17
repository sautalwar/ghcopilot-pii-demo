import { Router, Request, Response } from "express";
import {
  listUserRepos,
  scanRepo,
  scanAllRepos,
  scanRepoContents,
  SecurityFinding,
} from "../services/multi-repo-scanner";
import {
  generateFixDescription,
  createRemediationPR,
  getRemediationStatus,
} from "../services/auto-fix-service";

const router = Router();

// GET /repos — List all repos for the configured user
router.get("/repos", async (_req: Request, res: Response) => {
  try {
    const repos = await listUserRepos();
    res.json({ success: true, data: repos, meta: { count: repos.length } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /repos/scan — Scan ALL repos (full multi-repo scan)
router.get("/repos/scan", async (_req: Request, res: Response) => {
  try {
    const result = await scanAllRepos();
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /repos/:owner/:repo/scan — Scan a specific repo
router.get("/repos/:owner/:repo/scan", async (req: Request, res: Response) => {
  try {
    const fullName = `${req.params.owner}/${req.params.repo}`;
    const result = await scanRepo(fullName);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /repos/:owner/:repo/alerts — Get findings grouped by severity
router.get(
  "/repos/:owner/:repo/alerts",
  async (req: Request, res: Response) => {
    try {
      const fullName = `${req.params.owner}/${req.params.repo}`;
      const result = await scanRepo(fullName);
      const bySeverity: Record<string, SecurityFinding[]> = {
        critical: [],
        high: [],
        medium: [],
        low: [],
      };
      for (const f of result.findings) {
        bySeverity[f.severity]?.push(f);
      }
      res.json({
        success: true,
        data: {
          repo: result.repo,
          bySeverity,
          counts: {
            critical: bySeverity.critical.length,
            high: bySeverity.high.length,
            medium: bySeverity.medium.length,
            low: bySeverity.low.length,
            total: result.findings.length,
          },
          scannedAt: result.scannedAt,
          scanDurationMs: result.scanDurationMs,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

// GET /repos/:owner/:repo/fix/:findingId — Get AI fix description for a finding
router.get(
  "/repos/:owner/:repo/fix/:findingId",
  async (req: Request, res: Response) => {
    try {
      const fullName = `${req.params.owner}/${req.params.repo}`;
      const result = await scanRepo(fullName);
      const finding = result.findings.find(
        (f) => f.id === req.params.findingId
      );
      if (!finding) {
        res
          .status(404)
          .json({ success: false, error: "Finding not found" });
        return;
      }
      const fix = generateFixDescription({
        type: finding.type,
        severity: finding.severity,
        title: finding.title,
        description: finding.description,
        package: finding.package,
        cveId: finding.cveId,
        file: finding.file,
        line: finding.line,
      });
      res.json({ success: true, data: fix });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

// POST /repos/:owner/:repo/remediate — Trigger auto-remediation for a finding
router.post(
  "/repos/:owner/:repo/remediate",
  async (req: Request, res: Response) => {
    try {
      const fullName = `${req.params.owner}/${req.params.repo}`;
      const { findingId } = req.body as { findingId: string };
      if (!findingId) {
        res
          .status(400)
          .json({ success: false, error: "findingId is required in body" });
        return;
      }

      const result = await scanRepo(fullName);
      const finding = result.findings.find((f) => f.id === findingId);
      if (!finding) {
        res
          .status(404)
          .json({ success: false, error: "Finding not found" });
        return;
      }

      const fix = generateFixDescription({
        type: finding.type,
        severity: finding.severity,
        title: finding.title,
        description: finding.description,
        package: finding.package,
        cveId: finding.cveId,
        file: finding.file,
        line: finding.line,
      });

      const prResult = await createRemediationPR(fullName, fix, {
        assignTo: "copilot",
      });
      res.json({ success: true, data: prResult });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

// GET /repos/:owner/:repo/pr/:prNumber — Check remediation PR status
router.get(
  "/repos/:owner/:repo/pr/:prNumber",
  async (req: Request, res: Response) => {
    try {
      const fullName = `${req.params.owner}/${req.params.repo}`;
      const prNumber = Number(req.params.prNumber);
      if (Number.isNaN(prNumber)) {
        res.status(400).json({ success: false, error: "Invalid PR number" });
        return;
      }
      const status = await getRemediationStatus(fullName, prNumber);
      res.json({ success: true, data: status });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

// GET /repos/:owner/:repo/content-scan — Content-based scan (fetches actual files)
router.get(
  "/repos/:owner/:repo/content-scan",
  async (req: Request, res: Response) => {
    try {
      const owner = req.params.owner;
      const repo = req.params.repo;
      const result = await scanRepoContents(owner, repo);
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

export default router;
