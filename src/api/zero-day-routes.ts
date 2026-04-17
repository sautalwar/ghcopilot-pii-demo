import { Router, type Request, type Response } from "express";

import {
  getZeroDayAlerts,
  getEarlyDisclosures,
  getEPSSScore,
  getCISAKEVStatus,
  getActiveThreats,
} from "../services/zero-day-service";
import {
  getExploitabilityProfile,
  getCodeImpact,
  getBlastRadius,
  getRemediationForecast,
} from "../services/exploitability";
import { optionalAuth, requirePermission } from '../middleware/rbac';

const router = Router();

// TODO: Make auth required in production
router.use(optionalAuth);
router.use(requirePermission('zero-day:read'));

router.get("/alerts", async (_req: Request, res: Response) => {
  try {
    const data = await getZeroDayAlerts();
    res.json({
      success: true,
      data,
      meta: { source: "zero-day-intelligence", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch zero-day alerts",
    });
  }
});

router.get("/early-disclosures", async (req: Request, res: Response) => {
  try {
    const hours = req.query.hours ? Number(req.query.hours) : 48;
    const data = await getEarlyDisclosures(hours);
    res.json({
      success: true,
      data,
      meta: { source: "zero-day-intelligence", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch early disclosures",
    });
  }
});

router.get("/exploitability/:cveId", async (req: Request, res: Response) => {
  try {
    const packageName = req.query.package as string | undefined;
    if (!packageName) {
      res.status(400).json({
        success: false,
        error: "Missing required query parameter: package",
      });
      return;
    }

    const data = await getExploitabilityProfile(req.params.cveId, packageName);
    res.json({
      success: true,
      data,
      meta: { source: "zero-day-intelligence", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch exploitability profile",
    });
  }
});

router.get("/code-impact/:packageName", async (req: Request, res: Response) => {
  try {
    const data = await getCodeImpact(req.params.packageName);
    res.json({
      success: true,
      data,
      meta: { source: "zero-day-intelligence", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch code impact",
    });
  }
});

router.get("/forecast/:cveId", async (req: Request, res: Response) => {
  try {
    const packageName = req.query.package as string | undefined;
    if (!packageName) {
      res.status(400).json({
        success: false,
        error: "Missing required query parameter: package",
      });
      return;
    }

    const data = await getRemediationForecast(req.params.cveId, packageName);
    res.json({
      success: true,
      data,
      meta: { source: "zero-day-intelligence", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch remediation forecast",
    });
  }
});

router.get("/active-threats", async (_req: Request, res: Response) => {
  try {
    const data = await getActiveThreats();
    res.json({
      success: true,
      data,
      meta: { source: "zero-day-intelligence", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch active threats",
    });
  }
});

router.get("/blast-radius", async (_req: Request, res: Response) => {
  try {
    const data = await getBlastRadius();
    res.json({
      success: true,
      data,
      meta: { source: "zero-day-intelligence", timestamp: new Date().toISOString() },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch blast radius",
    });
  }
});

export default router;
