import { Router, type Request, type Response } from "express";

import {
  runAllChecks,
  getGovernancePolicy,
  isSecurityCertified,
  getCertificationReport,
  getAuditTrail,
} from "../services/governance-service";
import {
  getActiveExceptions,
  getExpiringSoon,
  isExcepted,
} from "../services/risk-exceptions-service";
import {
  auditLicenses,
  getViolations,
  getReviewRequired,
  generateSBOM,
} from "../services/license-compliance-service";
import { optionalAuth, requirePermission } from '../middleware/rbac';

const router = Router();

// TODO: Make auth required in production
router.use(optionalAuth);

// Store governance reports by PR number for certification lookup
const reportCache = new Map<number, Awaited<ReturnType<typeof runAllChecks>>>();

router.get("/policy", requirePermission('governance:read'), async (_req: Request, res: Response) => {
  try {
    const data = await getGovernancePolicy();
    res.json({
      success: true,
      data,
      meta: { source: "governance", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch governance policy",
    });
  }
});

router.post("/check/:prNumber", requirePermission('governance:approve'), async (req: Request, res: Response) => {
  try {
    const prNumber = Number(req.params.prNumber);
    const changedFiles = req.body?.changedFiles as string[] | undefined;

    const data = await runAllChecks(prNumber, changedFiles);
    reportCache.set(prNumber, data);

    res.json({
      success: true,
      data,
      meta: { source: "governance", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to run governance checks",
    });
  }
});

router.get("/certification/:prNumber", requirePermission('governance:read'), async (req: Request, res: Response) => {
  try {
    const prNumber = Number(req.params.prNumber);
    const report = reportCache.get(prNumber);

    if (!report) {
      res.status(404).json({
        success: false,
        error: `No governance report found for PR #${prNumber}. Run POST /check/${prNumber} first.`,
      });
      return;
    }

    const data = await getCertificationReport(prNumber, report);
    res.json({
      success: true,
      data,
      meta: { source: "governance", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch certification report",
    });
  }
});

router.get("/audit-trail", requirePermission('governance:read'), async (req: Request, res: Response) => {
  try {
    const days = req.query.days ? Number(req.query.days) : 30;
    const data = await getAuditTrail(days);
    res.json({
      success: true,
      data,
      meta: { source: "governance", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch audit trail",
    });
  }
});

router.get("/exceptions", requirePermission('governance:read'), async (_req: Request, res: Response) => {
  try {
    const data = await getActiveExceptions();
    res.json({
      success: true,
      data,
      meta: { source: "governance", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch active exceptions",
    });
  }
});

router.get("/exceptions/expiring", requirePermission('governance:read'), async (req: Request, res: Response) => {
  try {
    const days = req.query.days ? Number(req.query.days) : 30;
    const data = await getExpiringSoon(days);
    res.json({
      success: true,
      data,
      meta: { source: "governance", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch expiring exceptions",
    });
  }
});

router.post("/exceptions/check", requirePermission('governance:read'), async (req: Request, res: Response) => {
  try {
    const { filePath, ruleId } = req.body as { filePath: string; ruleId?: string };
    const data = await isExcepted(filePath, ruleId);
    res.json({
      success: true,
      data,
      meta: { source: "governance", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to check exception status",
    });
  }
});

router.get("/licenses", requirePermission('license:read'), async (_req: Request, res: Response) => {
  try {
    const data = await auditLicenses();
    res.json({
      success: true,
      data,
      meta: { source: "governance", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to audit licenses",
    });
  }
});

router.get("/licenses/violations", requirePermission('license:read'), async (_req: Request, res: Response) => {
  try {
    const data = await getViolations();
    res.json({
      success: true,
      data,
      meta: { source: "governance", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch license violations",
    });
  }
});

router.get("/licenses/review-required", requirePermission('license:read'), async (_req: Request, res: Response) => {
  try {
    const data = await getReviewRequired();
    res.json({
      success: true,
      data,
      meta: { source: "governance", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch licenses needing review",
    });
  }
});

router.get("/licenses/sbom", requirePermission('license:read'), async (_req: Request, res: Response) => {
  try {
    const data = await generateSBOM();
    res.json({
      success: true,
      data,
      meta: { source: "governance", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to generate SBOM",
    });
  }
});

router.get("/summary", requirePermission('governance:read'), async (_req: Request, res: Response) => {
  try {
    const [exceptions, expiring, licenses, auditTrail] = await Promise.all([
      getActiveExceptions(),
      getExpiringSoon(),
      auditLicenses(),
      getAuditTrail(30),
    ]);

    const data = {
      exceptions: {
        active: exceptions,
        expiringSoon: expiring,
      },
      licenses,
      auditTrail,
    };

    res.json({
      success: true,
      data,
      meta: { source: "governance", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch governance summary",
    });
  }
});

export default router;
