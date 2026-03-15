import { Router, type Request, type Response } from "express";

import {
  getAllCitizens,
  getAllCitizensRedacted,
  getCitizenById,
  getCitizenSchema,
  getDatabaseProof,
  getQueryLog,
  redactCitizenRecord,
  searchCitizens,
} from "./database";

export const piiDemoRouter = Router();

function buildMeta(redacted: boolean, proof: string): {
  source: string;
  copilot_involved: false;
  data_sent_to_cloud: false;
  redacted: boolean;
  timestamp: string;
  proof: string;
} {
  return {
    source: "local SQLite database (data/citizens.db)",
    copilot_involved: false,
    data_sent_to_cloud: false,
    redacted,
    timestamp: new Date().toISOString(),
    proof,
  };
}

function respondSuccess(response: Response, data: unknown, meta: ReturnType<typeof buildMeta>): Response {
  return response.json({
    success: true,
    data,
    meta,
  });
}

piiDemoRouter.get("/citizens", (_request: Request, response: Response) => {
  return respondSuccess(
    response,
    getAllCitizensRedacted(),
    buildMeta(
      true,
      "This data was queried locally from SQLite, masked inside your application, and returned without contacting Copilot. Verify in VS Code Developer Tools: the request stays on localhost only.",
    ),
  );
});

piiDemoRouter.get("/citizens/raw", (_request: Request, response: Response) => {
  return response.json({
    success: true,
    warning: "Risk demo only: this endpoint intentionally returns raw PII to prove what happens when redaction is skipped.",
    data: getAllCitizens(),
    meta: buildMeta(
      false,
      "This raw response still came only from the local SQLite file. Copilot was NOT contacted, but exposing raw PII like this is exactly why a redaction layer matters.",
    ),
  });
});

piiDemoRouter.get("/citizens/:id", (request: Request, response: Response) => {
  const citizenId = Number.parseInt(request.params.id, 10);

  if (Number.isNaN(citizenId)) {
    return response.status(400).json({
      success: false,
      error: "Citizen id must be a number.",
    });
  }

  const citizen = getCitizenById(citizenId);

  if (!citizen) {
    return response.status(404).json({
      success: false,
      error: `Citizen ${citizenId} was not found in the local SQLite database.`,
    });
  }

  return respondSuccess(
    response,
    redactCitizenRecord(citizen),
    buildMeta(
      true,
      "The server queried one citizen locally, masked the sensitive fields, and returned a safe payload. Copilot was not part of the runtime request path.",
    ),
  );
});

piiDemoRouter.get("/search", (request: Request, response: Response) => {
  const rawQuery = typeof request.query.q === "string" ? request.query.q.trim() : "";

  if (!rawQuery) {
    return response.status(400).json({
      success: false,
      error: "Query string parameter 'q' is required.",
    });
  }

  const results = searchCitizens(rawQuery).map(redactCitizenRecord);

  return response.json({
    success: true,
    query: rawQuery,
    data: results,
    meta: buildMeta(
      true,
      "Search executed against the local SQLite file only. The browser talked to localhost, Express talked to SQLite, and Copilot remained completely idle.",
    ),
  });
});

piiDemoRouter.get("/proof/network-log", (_request: Request, response: Response) => {
  return respondSuccess(
    response,
    {
      localhost_only: true,
      copilot_proxy_requests_observed: 0,
      outbound_requests_observed: [],
      query_log: getQueryLog(),
      verification_steps: [
        "Open VS Code Developer Tools > Network.",
        "Run one of the demo queries from pii-demo.html.",
        "Confirm the only browser network request is to localhost:3000.",
        "Confirm there are zero requests to copilot-proxy.githubusercontent.com during the API call.",
      ],
    },
    buildMeta(
      true,
      "These log entries are generated inside the app while it reads the local SQLite file. No outbound Copilot traffic was observed because runtime database access happens entirely on your infrastructure.",
    ),
  );
});

piiDemoRouter.get("/proof/copilot-context", (_request: Request, response: Response) => {
  const databaseProof = getDatabaseProof();

  return respondSuccess(
    response,
    {
      database: {
        ...databaseProof,
        schema: getCitizenSchema(),
      },
      copilot_can_see: [
        "Source files such as src/pii-demo/database.ts and src/pii-demo/pii-routes.ts",
        "Function names like getCitizenById(id) and getAllCitizensRedacted()",
        "SQL patterns such as SELECT id, first_name, last_name FROM citizens",
        "The masking calls maskSSN(), maskEmail(), and maskPhone()",
        "HTML and TypeScript source checked into the repository",
      ],
      copilot_cannot_see: [
        "The contents of data/citizens.db at runtime",
        "Query results returned after the server executes",
        "Browser search terms and user-entered values unless pasted into chat",
        "Actual SSNs, emails, phones, or names stored locally in SQLite",
        "The Canary Testbird record unless a human copies it into source code or chat",
      ],
      visible_source_examples: [
        "export function getCitizenById(id: number): DemoCitizen | undefined",
        "SELECT id, first_name, last_name, ssn, date_of_birth, email, phone, address, city, state, zip FROM citizens",
        "app.use('/api/pii-demo', piiDemoRouter)",
        "const safe = citizens.map(redactCitizenRecord)",
      ],
      content_exclusion: {
        copilotignore_patterns: ["data/**", "*.db", "*.sqlite"],
        explanation: "Even the local database file path is explicitly excluded from Copilot context by repository policy.",
      },
    },
    buildMeta(
      true,
      "This endpoint describes the design-time context Copilot can use: source code, file names, and static patterns. Runtime SQLite contents remain private to your running application.",
    ),
  );
});

export default piiDemoRouter;
