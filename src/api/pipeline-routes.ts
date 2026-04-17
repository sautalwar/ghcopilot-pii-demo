// ---------------------------------------------------------------------------
// Pipeline REST API Routes — Express router for remediation pipeline
// ---------------------------------------------------------------------------

import { Router, type Request, type Response } from 'express';
import { pipeline, type PipelineInput } from '../services/remediation-pipeline';
import type { PipelineStatus, PipelineEvent } from '../services/pipeline-types';

const router = Router();

// GET /api/pipeline/runs — List all runs (optional ?status= filter)
router.get('/runs', (_req: Request, res: Response) => {
  try {
    const statusFilter = _req.query.status as PipelineStatus | undefined;
    const runs = statusFilter ? pipeline.getRunsByStatus(statusFilter) : pipeline.getAllRuns();
    res.json({
      success: true,
      data: runs,
      meta: { total: runs.length, timestamp: new Date().toISOString() },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to list pipeline runs';
    res.status(500).json({ success: false, error: message });
  }
});

// GET /api/pipeline/summary — Dashboard summary stats
router.get('/summary', (_req: Request, res: Response) => {
  try {
    const summary = pipeline.getSummary();
    res.json({
      success: true,
      data: summary,
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to get pipeline summary';
    res.status(500).json({ success: false, error: message });
  }
});

// GET /api/pipeline/events — SSE stream of pipeline events
router.get('/events', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const handler = (event: PipelineEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  pipeline.onAny(handler);

  // Send heartbeat every 30s to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 30_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    pipeline.removeAllListeners();
  });
});

// GET /api/pipeline/runs/:id — Get single run details
router.get('/runs/:id', (req: Request, res: Response) => {
  try {
    const run = pipeline.getRun(req.params.id);
    if (!run) {
      res.status(404).json({ success: false, error: `Run ${req.params.id} not found` });
      return;
    }
    res.json({
      success: true,
      data: run,
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to get pipeline run';
    res.status(500).json({ success: false, error: message });
  }
});

// POST /api/pipeline/runs — Start new pipeline run
router.post('/runs', (req: Request, res: Response) => {
  try {
    const input = req.body as PipelineInput;
    if (!input.vulnId || !input.vulnSource || !input.severity) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: vulnId, vulnSource, severity',
      });
      return;
    }
    const run = pipeline.startRun(input);
    res.status(201).json({
      success: true,
      data: run,
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to start pipeline run';
    res.status(500).json({ success: false, error: message });
  }
});

// POST /api/pipeline/runs/:id/advance — Advance to next step
router.post('/runs/:id/advance', async (req: Request, res: Response) => {
  try {
    const run = await pipeline.advanceStep(req.params.id);
    res.json({
      success: true,
      data: run,
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to advance pipeline step';
    res.status(400).json({ success: false, error: message });
  }
});

// POST /api/pipeline/runs/:id/pause — Pause a run
router.post('/runs/:id/pause', (req: Request, res: Response) => {
  try {
    const run = pipeline.pauseRun(req.params.id);
    res.json({
      success: true,
      data: run,
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to pause pipeline run';
    res.status(400).json({ success: false, error: message });
  }
});

// POST /api/pipeline/runs/:id/resume — Resume a paused run
router.post('/runs/:id/resume', (req: Request, res: Response) => {
  try {
    const run = pipeline.resumeRun(req.params.id);
    res.json({
      success: true,
      data: run,
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to resume pipeline run';
    res.status(400).json({ success: false, error: message });
  }
});

// POST /api/pipeline/runs/:id/cancel — Cancel a run
router.post('/runs/:id/cancel', (req: Request, res: Response) => {
  try {
    const run = pipeline.cancelRun(req.params.id);
    res.json({
      success: true,
      data: run,
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to cancel pipeline run';
    res.status(400).json({ success: false, error: message });
  }
});

// POST /api/pipeline/runs/:id/retry — Retry failed step
router.post('/runs/:id/retry', async (req: Request, res: Response) => {
  try {
    const run = await pipeline.retryStep(req.params.id);
    res.json({
      success: true,
      data: run,
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to retry pipeline step';
    res.status(400).json({ success: false, error: message });
  }
});

export default router;
