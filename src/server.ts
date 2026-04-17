import cors from "cors";
import dotenv from "dotenv";
import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";

import authRoutes from "./api/auth-routes";
import demoRoutes from "./api/demo-routes";
import cveRoutes from "./api/cve-routes";
import zeroDayRoutes from "./api/zero-day-routes";
import vulnTrendsRoutes from "./api/vuln-trends-routes";
import governanceRoutes from "./api/governance-routes";
import jiraRoutes from "./api/jira-routes";
import pipelineRoutes from "./api/pipeline-routes";
import { piiDemoRouter } from "./pii-demo/pii-routes";

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.resolve(process.cwd(), "public")));

app.get("/api/health", (_request: Request, response: Response) => {
  response.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/demos", demoRoutes);
app.use("/api/pii-demo", piiDemoRouter);
app.use("/api/cves", cveRoutes);
app.use("/api/zero-day", zeroDayRoutes);
app.use("/api/trends", vulnTrendsRoutes);
app.use("/api/governance", governanceRoutes);
app.use("/api/jira", jiraRoutes);
app.use("/api/pipeline", pipelineRoutes);

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected server error";

  response.status(500).json({
    success: false,
    error: message,
  });
});

app.listen(port, () => {
  console.log(`Demo orchestration API listening on port ${port}`);
});
