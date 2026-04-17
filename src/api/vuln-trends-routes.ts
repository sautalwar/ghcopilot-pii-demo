import { Router, type Request, type Response } from "express";

import {
  getVulnTimeline,
  getMTTR,
  getFixedVulns,
  getOpenByAge,
  getSeverityTrends,
  getRemediationRate,
  getCopilotImpact,
  getTrendSummary,
  seedFromGitHub,
  generateDemoData,
} from "../services/vuln-trends-service";
import { optionalAuth, requirePermission, requireRole } from '../middleware/rbac';

const router = Router();

// TODO: Make auth required in production
router.use(optionalAuth);

router.get("/timeline", requirePermission('trends:read'), async (req: Request, res: Response) => {
  try {
    const days = req.query.days ? Number(req.query.days) : 90;
    const data = await getVulnTimeline(days);
    res.json({
      success: true,
      data,
      meta: { source: "vuln-trends", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch vulnerability timeline",
    });
  }
});

router.get("/mttr", requirePermission('trends:read'), async (_req: Request, res: Response) => {
  try {
    const data = await getMTTR();
    res.json({
      success: true,
      data,
      meta: { source: "vuln-trends", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch MTTR",
    });
  }
});

router.get("/fixed", requirePermission('trends:read'), async (req: Request, res: Response) => {
  try {
    const days = req.query.days ? Number(req.query.days) : 30;
    const data = await getFixedVulns(days);
    res.json({
      success: true,
      data,
      meta: { source: "vuln-trends", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch fixed vulnerabilities",
    });
  }
});

router.get("/open-by-age", requirePermission('trends:read'), async (_req: Request, res: Response) => {
  try {
    const data = await getOpenByAge();
    res.json({
      success: true,
      data,
      meta: { source: "vuln-trends", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch open vulnerabilities by age",
    });
  }
});

router.get("/severity", requirePermission('trends:read'), async (req: Request, res: Response) => {
  try {
    const days = req.query.days ? Number(req.query.days) : 90;
    const data = await getSeverityTrends(days);
    res.json({
      success: true,
      data,
      meta: { source: "vuln-trends", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch severity trends",
    });
  }
});

router.get("/rate", requirePermission('trends:read'), async (_req: Request, res: Response) => {
  try {
    const data = await getRemediationRate();
    res.json({
      success: true,
      data,
      meta: { source: "vuln-trends", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch remediation rate",
    });
  }
});

router.get("/copilot-impact", requirePermission('trends:read'), async (_req: Request, res: Response) => {
  try {
    const data = await getCopilotImpact();
    res.json({
      success: true,
      data,
      meta: { source: "vuln-trends", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch Copilot impact data",
    });
  }
});

router.get("/summary", requirePermission('trends:read'), async (_req: Request, res: Response) => {
  try {
    const data = await getTrendSummary();
    res.json({
      success: true,
      data,
      meta: { source: "vuln-trends", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch trend summary",
    });
  }
});

router.post("/seed", requireRole('security_admin', 'system_admin'), async (_req: Request, res: Response) => {
  try {
    const data = await seedFromGitHub();
    res.json({
      success: true,
      data,
      meta: { source: "vuln-trends", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to seed from GitHub",
    });
  }
});

router.post("/seed/demo", requireRole('security_admin', 'system_admin'), async (_req: Request, res: Response) => {
  try {
    const data = await generateDemoData();
    res.json({
      success: true,
      data,
      meta: { source: "vuln-trends", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to generate demo data",
    });
  }
});

export default router;
