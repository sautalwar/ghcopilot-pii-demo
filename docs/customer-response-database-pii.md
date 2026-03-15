# Customer Question: What About Connecting Copilot to a Database with Private Information?

---

## The Exact Customer Question

> "What about connecting Copilot to a system or a database that has private information in it? What are the precautions to take there? What if Copilot is making the tool calls to do that and search the data and then extract it? And then the worry is that it transmits it as part of formulating an answer for you or something, right?"

---

## The Direct Answer

This is the right question to ask, and the answer has two parts:

**Part 1 — Standard Copilot Chat/Autocomplete**: Copilot **cannot** connect to any database. It is a design-time code assistant that reads your source code files. It has no ability to execute code, open network connections, or run SQL queries. When you query your database from your application, Copilot is not involved at all.

**Part 2 — Copilot Agent Mode with MCP Tools**: When you *explicitly* give Copilot the ability to call tools via MCP (Model Context Protocol), **whatever the tool returns becomes part of the conversation context**. This means if your MCP tool returns raw SSNs from a database, yes, Copilot will see those SSNs. But this is entirely under your control — you write the tool, you control what it returns.

The precaution is simple: **never return raw PII from MCP tools. Apply redaction before the data reaches Copilot.**

---

## Understanding the Three Scenarios

### Scenario 1: Copilot Chat (No Database Access — Zero Risk)

```
Developer types in VS Code Chat:
  "How do I query the citizens table?"

What happens:
  ┌──────────────────┐
  │  Your Source Code │ ← Copilot reads THIS
  │  database.ts     │
  │  pii-routes.ts   │
  └──────────────────┘
          │
          ▼
  ┌──────────────────┐
  │  Copilot Model   │ → Suggests SQL patterns, function calls
  └──────────────────┘

  ┌──────────────────┐
  │  Your Database   │ ← Copilot NEVER touches this
  │  citizens.db     │
  │  SSNs, emails... │
  └──────────────────┘

Copilot sees: Function names, SQL patterns, type definitions
Copilot does NOT see: Any actual data in the database
Risk: NONE — Copilot has no runtime database connectivity
```

**Proof**: Ask Copilot "What SSNs are in the citizens database?" — it cannot answer. Ask "What does getCitizenById do?" — it can answer (it reads the code, not the data).

### Scenario 2: Your Application Queries the Database (Copilot Not Involved)

```
User makes HTTP request:
  GET /api/citizens

What happens:
  ┌──────────────────┐     ┌──────────────────┐
  │  Your Express    │────→│  SQLite Database  │
  │  Server          │←────│  citizens.db      │
  └──────────────────┘     └──────────────────┘
          │
          ▼
  ┌──────────────────┐
  │  Redaction Layer  │ → Masks SSN, email, phone
  └──────────────────┘
          │
          ▼
  ┌──────────────────┐
  │  HTTP Response   │ → { ssn: "***-**-1234" }
  └──────────────────┘

  ┌──────────────────┐
  │  Copilot         │ ← NOT INVOLVED AT ALL
  └──────────────────┘

Risk: NONE — This is standard application flow. Copilot is not in the data path.
```

**Proof**: Open VS Code DevTools → Network tab → query the database → zero requests to `copilot-proxy.githubusercontent.com`. The query stays on localhost.

### Scenario 3: MCP Tool Calls (The Real Risk — But You Control It)

This is where the customer's concern is valid. When you configure an MCP server and give Copilot tools that can query a database, the tool output enters the conversation context.

```
Developer types in VS Code Chat:
  @database-tool "Look up citizen #5"

What happens with a DANGEROUS tool:
  ┌──────────────────┐
  │  Copilot Model   │ → Calls MCP tool "lookup_citizen"
  └──────────────────┘
          │
          ▼
  ┌──────────────────┐     ┌──────────────────┐
  │  MCP Server      │────→│  Database         │
  │  (your code)     │←────│  citizens.db      │
  └──────────────────┘     └──────────────────┘
          │
          ▼ Returns RAW data: { ssn: "123-45-6789" }
  ┌──────────────────┐
  │  Copilot Model   │ ← NOW sees the SSN in context
  └──────────────────┘
          │
          ▼
  "Citizen #5 has SSN 123-45-6789"  ← LEAKED IN RESPONSE

Risk: HIGH if tool returns raw PII
Fix: REDACT inside the tool before returning
```

---

## The Fix: Redaction at the Tool Boundary

### ❌ DANGEROUS MCP Tool — Returns Raw PII

```typescript
// This tool gives Copilot access to raw PII
server.tool("lookup_citizen", {
  description: "Look up a citizen by ID",
  inputSchema: { type: "object", properties: { id: { type: "number" } } }
}, async ({ id }) => {
  const citizen = db.prepare("SELECT * FROM citizens WHERE id = ?").get(id);
  
  // DANGER: Raw PII goes directly to Copilot's context
  return {
    content: [{ 
      type: "text", 
      text: JSON.stringify(citizen)
      // { ssn: "123-45-6789", email: "john@real.com", phone: "(555) 123-4567" }
    }]
  };
});
```

**What happens**: Copilot receives the full SSN, email, and phone number. It can (and likely will) include these in its response to the developer. The PII has now been transmitted through the AI model.

### ✅ SAFE MCP Tool — Returns Redacted Data

```typescript
// This tool protects PII before Copilot ever sees it
server.tool("lookup_citizen", {
  description: "Look up a citizen by ID (PII redacted)",
  inputSchema: { type: "object", properties: { id: { type: "number" } } }
}, async ({ id }) => {
  const citizen = db.prepare("SELECT * FROM citizens WHERE id = ?").get(id);
  
  if (!citizen) {
    return { content: [{ type: "text", text: "Citizen not found" }] };
  }

  // SAFE: Redact PII before it reaches Copilot
  const safe = {
    id: citizen.id,
    first_name: citizen.first_name,
    last_name: citizen.last_name,
    ssn: `***-**-${citizen.ssn.slice(-4)}`,           // Only last 4 digits
    email: `${citizen.email[0]}***@${citizen.email.split('@')[1]}`,
    phone: `(***) ***-${citizen.phone.slice(-4)}`,
    city: citizen.city,
    state: citizen.state
  };

  return {
    content: [{ 
      type: "text", 
      text: JSON.stringify(safe)
      // { ssn: "***-**-6789", email: "j***@real.com", phone: "(***) ***-4567" }
    }]
  };
});
```

**What happens**: Copilot receives only masked data. Even if it includes the response verbatim, no full SSN is ever exposed. The redaction happens **inside your infrastructure** before any data reaches the model.

### ✅ SAFEST: Don't Give Copilot Database Tools At All

```typescript
// Instead of a database lookup tool, give Copilot a SCHEMA tool
server.tool("get_database_schema", {
  description: "Get the schema of the citizens table",
  inputSchema: { type: "object", properties: {} }
}, async () => {
  // Return structure, not data
  return {
    content: [{ 
      type: "text", 
      text: JSON.stringify({
        table: "citizens",
        columns: [
          { name: "id", type: "INTEGER", primary_key: true },
          { name: "first_name", type: "TEXT" },
          { name: "last_name", type: "TEXT" },
          { name: "ssn", type: "TEXT", sensitive: true, format: "XXX-XX-XXXX" },
          { name: "email", type: "TEXT", sensitive: true },
          { name: "phone", type: "TEXT", sensitive: true }
        ],
        row_count: 10
      })
    }]
  };
});
```

**What happens**: Copilot can help you write queries and understand the schema without ever seeing a single row of actual data. This is the pattern GitHub itself recommends.

---

## The Key Principle

> **"The blast radius of Copilot is the blast radius of the tools you give it."**

Think of it like giving keys to a contractor:

| What You Give | Analogy | Risk Level |
|---|---|---|
| Copilot Chat only (no MCP) | Contractor sees the building blueprints, never enters the vault | **No risk** |
| MCP tool with schema only | Contractor knows the vault has 10 safety deposit boxes but can't open them | **No risk** |
| MCP tool with redacted output | Contractor can see box numbers but contents are sealed | **Minimal risk** |
| MCP tool with raw database access | Contractor has the master key to every box | **High risk** |

You control which keys you hand over. GitHub Copilot never picks locks.

---

## Live Working Example: Step-by-Step Demo

### What You'll Show the Customer

A running application with a SQLite database containing 10 citizens with fake PII (SSNs, emails, phones). You'll prove that:

1. Copilot cannot see the database data
2. The application can query it (with redaction)
3. No data is transmitted to any AI service during queries
4. A "canary" record proves Copilot is blind to runtime data
5. The safe MCP pattern prevents PII from entering Copilot's context

### Prerequisites

```bash
git clone https://github.com/sautalwar/ghcopilot-pii-demo.git
cd ghcopilot-pii-demo
npm install
npx ts-node src/server.ts
# Server starts on http://localhost:3000
```

Open `http://localhost:3000/pii-demo.html` in your browser.

---

### Step 1: Show the Database Has Real PII (2 minutes)

**Action**: Click **"Query Database (Raw — Risk Demo)"** on the PII demo page

**What the customer sees**: A table of 10 citizens with full SSNs like `000-11-1201`, full emails like `avery.example@example.test`, full phone numbers.

**Say**: *"This is our local SQLite database. It contains Social Security numbers, emails, and phone numbers. This data exists only on this machine — it's never committed to Git, never uploaded anywhere."*

**Alternatively, from terminal**:
```bash
curl http://localhost:3000/api/pii-demo/citizens/raw | python -m json.tool
```

---

### Step 2: Show Redacted Access (2 minutes)

**Action**: Click **"Query Database (Redacted)"**

**What the customer sees**: Same citizens but SSNs show as `***-**-1201`, emails as `a***@example.test`, phones as `(***) ***-1201`.

**Say**: *"Same data, but our application's redaction layer masks the PII. This is the pattern we use for any external-facing endpoint — including any MCP tool we might build for Copilot."*

**Point out the response metadata**:
```json
{
  "meta": {
    "copilot_involved": false,
    "redacted": true,
    "proof": "This data was queried locally from SQLite, masked inside your application..."
  }
}
```

---

### Step 3: Prove Copilot Can't See Runtime Data (3 minutes)

**Action**: Open VS Code → Copilot Chat → Type:

```
What Social Security numbers are stored in the citizens database?
```

**What the customer sees**: Copilot says something like *"I don't have access to your database"* or gives generic advice about querying databases.

**Say**: *"Copilot reads your source code — it knows you HAVE a citizens table, it knows the SSN column exists, it can help you write queries. But it cannot execute those queries or see the results."*

**Follow-up**: Type in Copilot Chat:

```
What does the function getAllCitizensRedacted do in our codebase?
```

**What the customer sees**: Copilot accurately describes the function — it reads the TypeScript source code.

**Say**: *"See the difference? Copilot knows the CODE (design-time) but not the DATA (runtime). It can describe the function but not the function's output."*

---

### Step 4: The Canary Test — Definitive Proof (3 minutes)

**Action**: Click **"Search for Canary"** on the demo page

**What the customer sees**: The app finds "Canary Testbird" (citizen #10, SSN: 000-00-0000) immediately.

**Now ask Copilot Chat**:
```
Is there a citizen named "Canary Testbird" in our database?
```

**What the customer sees**: Copilot doesn't know. It might say *"I can see your code references a citizens table but I can't query it."*

**Say**: *"This is the canary test. We planted a unique sentinel record — 'Canary Testbird' — that exists ONLY in the database. Our application finds it instantly. Copilot has no idea it exists. If Copilot could see runtime data, it would know about Canary Testbird. It doesn't. This is definitive proof."*

---

### Step 5: Network Evidence — Zero AI Calls (3 minutes)

**Action**: Open VS Code → `Ctrl+Shift+I` → Developer Tools → Network tab → Clear the log

**Action**: Click **"Query Database (Redacted)"** again on the demo page

**What the customer sees**: Network requests to `localhost:3000` only. Zero requests to `copilot-proxy.githubusercontent.com` or any other external endpoint.

**Say**: *"Watch the network tab. The database query is a pure localhost operation. Nothing goes to GitHub, nothing goes to Microsoft, nothing goes to Anthropic. The data never leaves your machine."*

**Reinforce with the proof endpoint**:
```bash
curl http://localhost:3000/api/pii-demo/proof/network-log | python -m json.tool
```

**What the customer sees**:
```json
{
  "proof": {
    "outbound_ai_calls": 0,
    "copilot_proxy_requests_observed": 0,
    "all_queries_local": true,
    "query_log": [
      { "query": "getAllCitizensRedacted", "destination": "localhost SQLite" }
    ]
  }
}
```

---

### Step 6: Show the Architectural Safeguards (5 minutes)

**Action**: Open `.copilotignore` in VS Code:

```
*.db
*.sqlite
*.sqlite3
data/**
```

**Say**: *"Even at design time, we block Copilot from indexing database files. This is local-level defense."*

**Action**: Navigate to GitHub repository → Settings → Copilot → Content Exclusion

**Say**: *"For enterprise, admins enforce content exclusion at the org level. This is deterministic and platform-enforced — developers cannot override it. The database files are excluded BEFORE prompt construction."*

**Action**: Show the safe vs. unsafe MCP tool code side by side (from this document or the demo page)

**Say**: *"If you DO want to give Copilot database access via MCP tools, here's the safe pattern: redact PII inside the tool before anything reaches the model. The dangerous pattern returns raw data. The safe pattern returns masked data. You control this — it's your code."*

---

### Step 7: Answer "But What If Someone Builds an Unsafe Tool?" (2 minutes)

**Say**: *"That's exactly the right question. This is why we recommend three safeguards for MCP tools:"*

1. **Code review for MCP tools** — treat tool definitions like API endpoints. Review what they return.
2. **Redaction library** — standardize a `maskSSN()`, `maskEmail()`, `maskPhone()` library that all MCP tools must use.
3. **Output auditing** — log what MCP tools return and alert on PII patterns (same as you'd monitor any API).

*"The risk is not that Copilot secretly accesses your database. The risk is that a developer builds a tool that returns raw PII. That's the same risk you have with any API endpoint or internal service. The mitigation is the same too: code review, redaction libraries, and monitoring."*

---

### Step 8: Summarize with the Trust Framework (2 minutes)

**Show the layered defense stack**:

```
┌──────────────────────────────────────────────────────────┐
│  Layer 5: Human Code Review of MCP Tools (Final Check)   │
├──────────────────────────────────────────────────────────┤
│  Layer 4: Output Auditing (Monitor what tools return)    │
├──────────────────────────────────────────────────────────┤
│  Layer 3: Redaction Library (maskSSN, maskEmail, etc.)   │
│  Applied INSIDE the MCP tool before data reaches model   │
├──────────────────────────────────────────────────────────┤
│  Layer 2: Content Exclusion (Platform-Enforced)          │
│  Database files never reach the model at design time     │
├──────────────────────────────────────────────────────────┤
│  Layer 1: Architecture (Copilot ≠ Runtime)               │
│  Copilot reads code, not databases. Zero runtime access. │
└──────────────────────────────────────────────────────────┘
```

**Say**: *"Bottom line: Standard Copilot Chat has zero database access — proven by the canary test. MCP tools give you explicit control over what Copilot can see — proven by the safe vs. unsafe code patterns. And content exclusion ensures database files are never indexed even at design time. You control every layer."*

---

## Anticipated Follow-Up Questions

### "What if the developer accidentally puts PII in a code comment?"

**Answer**: If someone writes `// SSN for John: 123-45-6789` in a `.ts` file, yes, Copilot can see that comment (it reads source code). This is why:
- Secret Scanning detects patterns that look like SSNs and alerts
- Code review should catch PII in comments
- `.copilotignore` / content exclusion can block specific files
- Training developers not to put real PII in code comments is essential (same as not hardcoding passwords)

### "What about Copilot Workspace or Copilot in GitHub.com?"

**Answer**: Same boundary applies. Copilot on github.com can read files in the repository but cannot execute code or access databases. Content exclusion policies apply to Copilot on github.com as well.

### "What if we use AI Foundry or local models instead?"

**Answer**: If you use a local model (via AI Foundry or similar), your prompts never leave your infrastructure at all. This eliminates the data-in-transit concern entirely. The design-time vs. runtime boundary still applies — the local model reads code, not databases.

### "Can you guarantee Copilot won't hallucinate PII that happens to be real?"

**Answer**: Copilot can generate synthetic data that might coincidentally match real values (like a random 9-digit number matching a real SSN). This is a property of all generative AI, not specific to Copilot. Mitigations:
- Use `copilot-instructions.md` to instruct: "Use obviously fake test data (SSN: 000-00-0000)"
- This is probabilistic, not guaranteed — but dramatically reduces the chance
- Secret scanning catches committed values that match known patterns

### "Show me the data flow end to end — where does my prompt go?"

**Answer**: Navigate to the main demo page → Copilot Security tab → Interactive Data Flow diagram. Click each of the 5 nodes to see proof:

1. **Developer Prompt** → Leaves VS Code
2. **Copilot Extension** → Packages context (only non-excluded files)
3. **GitHub Proxy** → `copilot-proxy.githubusercontent.com` (the only endpoint, verify with `nslookup`)
4. **Model Provider** → Azure OpenAI or Anthropic (ZDR for Claude, 30-day opt-out for OpenAI)
5. **Response** → Returns to VS Code, prompt is discarded

Each node has a proof command you can run live to verify.

---

## Sources

1. [GitHub Docs: Content Exclusion](https://docs.github.com/en/copilot/concepts/context/content-exclusion)
2. [GitHub Docs: Enhance Agent Mode with MCP](https://docs.github.com/en/copilot/tutorials/enhance-agent-mode-with-mcp)
3. [GitHub Docs: Custom Agents Configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration)
4. [GitHub Community: Secrets in Copilot Agent Environment](https://github.com/orgs/community/discussions/180346)
5. [Copilot Content Exclusions: Four Layers of Defense](https://blog.cloud-eng.nl/2026/03/13/copilot-content-exclusions-four-layers/)
6. [GitGuardian: GitHub Copilot Privacy Risks](https://blog.gitguardian.com/github-copilot-security-and-privacy/)

---

*Live demo: http://localhost:3000/pii-demo.html*
*Repository: https://github.com/sautalwar/ghcopilot-pii-demo*
*Main demo portal: http://localhost:3000*
