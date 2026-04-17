import { Router, Request, Response } from 'express';
import { scanRepository, getRecommendations, RepoScanResult, SecurityIssue } from '../services/repo-scanner';
import { buildInventory, findDependencyChains, DependencyNode, DependencyInventory } from '../services/dep-inventory';

const router = Router();

// GET /repo — Full repository scan
router.get('/repo', (_req: Request, res: Response) => {
  try {
    const result: RepoScanResult = scanRepository();
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /secrets — Secret detection only
router.get('/secrets', (_req: Request, res: Response) => {
  try {
    const result = scanRepository();
    const secrets = result.issues.filter(i => i.type === 'secret');
    res.json({ success: true, data: { issues: secrets, count: secrets.length } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /dependencies — Full dependency tree
router.get('/dependencies', (_req: Request, res: Response) => {
  try {
    const inventory: DependencyInventory = buildInventory();
    res.json({
      success: true,
      data: {
        direct: Object.fromEntries(inventory.direct),
        totalCount: inventory.totalCount,
        maxDepth: inventory.maxDepth,
        tree: inventory.tree,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /dependencies/:pkg/chain — Dependency chain for a package
router.get('/dependencies/:pkg/chain', (req: Request, res: Response) => {
  try {
    const pkg = decodeURIComponent(req.params.pkg);
    const chain = findDependencyChains(pkg);
    res.json({ success: true, data: chain });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /recommendations — Prioritized fix recommendations
router.get('/recommendations', (_req: Request, res: Response) => {
  try {
    const result = scanRepository();
    const recommendations = getRecommendations(result.issues);
    res.json({ success: true, data: recommendations });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /summary — Quick summary stats
router.get('/summary', (_req: Request, res: Response) => {
  try {
    const scanResult = scanRepository();
    const inventory = buildInventory();
    res.json({
      success: true,
      data: {
        scan: scanResult.summary,
        dependencies: {
          total: inventory.totalCount,
          direct: inventory.direct.size,
          maxDepth: inventory.maxDepth,
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
