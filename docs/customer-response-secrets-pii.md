# Customer Response: How Copilot Handles Secrets & Sensitive Data

## Answering the Customer's Exact Questions

---

## Question 1: "Copilot can see secrets in your environment — how do we prevent it from transmitting that?"

### The Direct Answer

You're right that Copilot, when operating in agent mode, *can* see files in your workspace — including files that may contain secrets. But "seeing" and "transmitting" are two different things, and GitHub provides **four layers of defense** to prevent exposure:

### Layer 1: Content Exclusion (Platform-Enforced, GA)

Content exclusion is the **deterministic, admin-enforced** control. Unlike `.copilotignore` (which is best-effort), content exclusion is configured at the **organization or repository level** by admins and **cannot be overridden by developers**.

- **How it works**: Admins define file path patterns (globs) in GitHub Settings → Copilot → Content Exclusion. These patterns are enforced **before prompt construction** — excluded files are never sent to the model.
- **Scope**: Applies to inline suggestions, Copilot Chat context, and Copilot code review.
- **Proof**: When you open an excluded file in VS Code, the Copilot icon shows a slash through it — Copilot is completely inactive for that file.
- **Source**: [GitHub Docs: Content Exclusion](https://docs.github.com/en/copilot/concepts/context/content-exclusion)

**Live Demo Step**:
1. Add `*.env` and `secrets/**` to content exclusion in your GitHub org settings
2. Open a `.env` file in VS Code → notice the slashed Copilot icon
3. Try asking Copilot Chat "what's in my .env file?" → it cannot answer
4. Open a regular `.ts` file → Copilot works normally

### Layer 2: Copilot Instructions (Best-Effort, Defense-in-Depth)

The `.github/copilot-instructions.md` file provides instructions to the model. These are **NOT a security boundary** — they are probabilistic, not deterministic. However, they add a valuable layer:

```markdown
## ⚠️ IMPORTANT: This file is NOT a security boundary

## PII Handling Rules (Best-Effort)
1. Never output raw Social Security Numbers in suggestions
2. Always use parameterized queries when writing SQL
3. Prefer the redaction service when working with citizen data
4. Do not hardcode credentials in source files
5. When suggesting test data, use obviously fake values (e.g., SSN: 000-00-0000)
```

**Why it matters**: Even though instructions aren't 100% deterministic, they significantly reduce the probability of Copilot suggesting patterns that expose secrets. Think of it as a seatbelt — not a guarantee, but dramatically better than nothing.

### Layer 3: Environment Scoping for Agent Mode

When using Copilot Coding Agent (the autonomous agent that runs in GitHub-hosted runners):

- **Secrets are NOT inherited automatically** from organization or repository settings
- You must **explicitly add secrets** to a dedicated `copilot` environment in Repository Settings → Environments → Copilot
- The agent environment is **ephemeral** — destroyed after each session
- Secrets are injected via `${{ secrets.MY_SECRET }}` in the setup workflow, never hardcoded

**Source**: [GitHub Docs: Customize Agent Environment](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-environment)

### Layer 4: Secret Scanning + Push Protection

Even if a secret accidentally makes it into code:

- **GitHub Secret Scanning** detects 200+ secret patterns in real-time
- **Push Protection** blocks the commit before it reaches the repository
- **Copilot can help remediate** secret scanning alerts via agent mode

**Source**: [Microsoft Learn: Resolve Secret Scanning Alerts with Copilot Agent](https://learn.microsoft.com/en-us/training/modules/resolve-github-secret-scanning-alerts-github-copilot-agent/)

---

## Question 2: "You have a file full of Social Security numbers — how do we prevent transmitting that?"

### The Direct Answer

This is the most important distinction to understand: **Copilot is a design-time assistant, not a runtime data processor.**

Copilot sees your **source code** (the instructions), not your **runtime data** (the results). Here's the proof:

### What Copilot CAN See (Design-Time)

| Category | Example |
|----------|---------|
| Function names | `getCitizenById(id)` |
| SQL patterns | `SELECT * FROM citizens WHERE id = ?` |
| Type definitions | `interface Citizen { ssn: string; }` |
| Variable names | `citizen.ssn` |
| Source files | `.ts`, `.js`, `.py` files in your workspace |
| Test fixtures | Fake data in test files |

### What Copilot CANNOT See (Runtime)

| Category | Example |
|----------|---------|
| Database contents | Actual citizen records |
| Query results | The SSNs returned by a SELECT query |
| File contents of data files | `.db`, `.sqlite`, `.csv` data files |
| Environment variable values | `process.env.DB_PASSWORD` at runtime |
| API response payloads | What your server returns to clients |
| In-memory application state | Objects in your running process |

### The Canary Test — Definitive Proof

We built a live demo that proves this conclusively:

1. **Seed a database** with 10 fake citizens including a sentinel record: **"Canary Testbird"** with SSN `000-00-0000`
2. **Ask Copilot**: "Is there a citizen named Canary Testbird in the database?"
   - Copilot **cannot answer** — it has no access to runtime database data
3. **Ask the application**: Query the API endpoint → it finds Canary Testbird immediately
4. **Ask Copilot**: "What does the getCitizenById function do?"
   - Copilot **can answer** — it sees the source code

This is the killer demo. The canary record exists only in the database. If Copilot could see runtime data, it would know about Canary Testbird. It doesn't.

### Additional Defenses for Data Files

- **`.copilotignore`**: Add `*.db`, `*.sqlite`, `data/**` to prevent Copilot from indexing data files
- **Content Exclusion**: Add `data/**` patterns at the org level for platform-enforced blocking
- **`.gitignore`**: Data files should never be in source control anyway

---

## Question 3: "What about when Copilot makes tool calls (MCP) and extracts data — could it transmit that in its response?"

### The Direct Answer

This is the legitimate risk area, and it requires a nuanced answer:

**The risk is real but manageable.** When Copilot uses MCP (Model Context Protocol) to call external tools, the tool's output becomes part of the conversation context. If that tool returns raw PII, Copilot *could* include it in its response.

### The Mitigation: Redaction at the Tool Layer

The solution is architectural: **never return raw PII from MCP tool endpoints**.

```typescript
// ❌ DANGEROUS — MCP tool returns raw PII
server.tool("lookup_citizen", async ({ id }) => {
  const citizen = getCitizenById(id);
  return { content: [{ type: "text", text: JSON.stringify(citizen) }] };
  // Copilot now has the raw SSN in context
});

// ✅ SAFE — MCP tool returns redacted data
server.tool("lookup_citizen", async ({ id }) => {
  const citizen = getCitizenById(id);
  return { content: [{ type: "text", text: JSON.stringify({
    ...citizen,
    ssn: maskSSN(citizen.ssn),       // "***-**-1234"
    email: maskEmail(citizen.email), // "a***@example.com"
    phone: maskPhone(citizen.phone)  // "(***) ***-1234"
  })}]};
  // Copilot only sees masked values
});
```

### Key Principle

> "The blast radius of Copilot is the blast radius of the tools you give it."

If you give Copilot an MCP tool that returns raw SSNs, yes, Copilot will see those SSNs. But that's a **tool design problem**, not a Copilot problem. The same way you wouldn't give a human intern unrestricted database access, you shouldn't give an AI tool unrestricted access either.

### What Your Internal Team Should Do

Your team mentioned they've already started this:

> "We've reworked some internal tooling so that they pass secrets directly to a command instead of via the environment."

This is exactly right. Extend this pattern to MCP tools:
1. **Pass secrets directly** to commands, not via environment variables Copilot can read
2. **Return redacted data** from any MCP tool that accesses PII
3. **Use content exclusion** to block data files from design-time context
4. **Audit MCP tool outputs** before deploying them

---

## Question 4: ".md instruction files are suggestions, not deterministic — so how do we actually enforce security?"

### The Direct Answer

You're absolutely right. The customer's concern is valid: `copilot-instructions.md` is **NOT a security boundary**. The instructions are probabilistic — the LLM follows them most of the time but not 100%.

### The Framework: Deterministic vs. Probabilistic Controls

| Control | Type | Enforcement |
|---------|------|-------------|
| Content Exclusion (org settings) | **Deterministic** | Platform-enforced before prompt construction |
| Secret Scanning + Push Protection | **Deterministic** | Blocks commits containing secrets |
| `.copilotignore` | **Deterministic** | IDE-level file exclusion |
| Environment scoping (agent mode) | **Deterministic** | Secrets only accessible in explicit `copilot` environment |
| `copilot-instructions.md` | **Probabilistic** | Best-effort model instructions |
| Prompt engineering | **Probabilistic** | Guides but doesn't guarantee behavior |

### The Security-First Approach

**Never rely on probabilistic controls alone.** Layer deterministic controls first, then add probabilistic controls as defense-in-depth:

1. **First**: Content exclusion (deterministic) — sensitive files never reach the model
2. **Second**: Secret scanning (deterministic) — catches anything that slips through
3. **Third**: Environment scoping (deterministic) — agent can't access secrets you don't give it
4. **Fourth**: Instructions (probabilistic) — reduces likelihood of unsafe suggestions
5. **Fifth**: Code review (human) — final validation before merge

---

## Multi-Model Security (Claude Sonnet/Opus)

Since the customer plans to use Anthropic models, here are the key facts:

### Data Flow for Claude Models via Copilot

1. Your prompt goes from VS Code → `copilot-proxy.githubusercontent.com` (GitHub's proxy)
2. GitHub's proxy forwards to **Anthropic's API** (under Microsoft's sub-processor agreement)
3. **Zero Data Retention (ZDR)**: Anthropic has a ZDR agreement with Microsoft — prompts are NOT stored for training, NOT logged for 30 days
4. Anthropic became a **Microsoft sub-processor** on January 7, 2026 — governed by Microsoft's DPA
5. Claude Sonnet/Opus are **disabled by default** in EU/EFTA/UK — admin must explicitly opt-in

### Context Windows

| Model | Context Window | Notes |
|-------|---------------|-------|
| Claude Sonnet 4/4.6 | **1,000,000 tokens** | ~750K words — entire codebases fit |
| Claude Opus 4.6 | **200,000 tokens** | Premium reasoning model |
| GPT-4.1 | **128,000 tokens** | Microsoft's model |

### Key Security Fact

> "Even with a 1M token context window, Copilot only sends what's in your active workspace context. A larger context window doesn't mean more data is collected — it means Copilot can reason about more of your code at once."

**Source**: You can verify which model handled your request by checking the `x-model-version` response header in VS Code Developer Tools → Network tab.

---

## Working Example: Step-by-Step Demo Script

### Prerequisites
- VS Code with GitHub Copilot extension
- The demo repository: `https://github.com/sautalwar/ghcopilot-pii-demo`
- Node.js installed

### Setup (5 minutes)

```bash
git clone https://github.com/sautalwar/ghcopilot-pii-demo.git
cd ghcopilot-pii-demo
npm install
npx ts-node src/server.ts
```

The server starts on `http://localhost:3000`. Navigate to `http://localhost:3000/pii-demo.html`.

---

### Demo Part 1: Prove Copilot Can't See Database Data (10 minutes)

**Step 1 — Show the database has real PII**
```bash
# In terminal (or use the "Query Database (Raw)" button on the webpage)
curl http://localhost:3000/api/pii-demo/citizens/raw | jq '.data[0]'
```
**What you'll see**: Full SSN (`000-11-1201`), full email, full phone number.

**Say**: "This is real data in our local SQLite database. 10 citizens with full PII."

**Step 2 — Show the redacted endpoint**
```bash
curl http://localhost:3000/api/pii-demo/citizens | jq '.data[0]'
```
**What you'll see**: Masked SSN (`***-**-1201`), masked email (`a***@example.test`).

**Say**: "Our application masks PII before returning it. Copilot helped write this code, but Copilot never sees the data flowing through it."

**Step 3 — Ask Copilot about the database**

Open VS Code Copilot Chat and type:
```
What SSNs are stored in the citizens database?
```
**What you'll see**: Copilot says it can't access the database or gives generic guidance.

**Say**: "Copilot has no idea what's in the database. It can see the code that queries the database, but not the query results."

**Step 4 — Ask Copilot about the code**
```
What does the getCitizenById function do?
```
**What you'll see**: Copilot accurately describes the function — it reads the source code.

**Say**: "Copilot knows the code because it can read `database.ts`. But it can't execute that code or see what it returns."

**Step 5 — The Canary Test**
```
Is there a citizen named Canary Testbird in our database?
```
**What you'll see**: Copilot doesn't know.

Then click "Run Canary Test" on the demo page — the app finds Canary Testbird instantly.

**Say**: "We planted a sentinel record. If Copilot could see runtime data, it would know about Canary Testbird. It doesn't. Case closed."

---

### Demo Part 2: Prove No Data Leaves Your Machine (5 minutes)

**Step 6 — Open VS Code Developer Tools**

Press `Ctrl+Shift+I` → Network tab → Filter by `copilot`

**Step 7 — Query the database**

Click "Query Database (Redacted)" on the demo page.

**Step 8 — Check the Network tab**

**What you'll see**: Zero new requests to `copilot-proxy.githubusercontent.com`.

**Say**: "The database query is a localhost-only operation. No data was sent to GitHub, Microsoft, or any AI provider."

**Step 9 — Check the proof endpoint**
```bash
curl http://localhost:3000/api/pii-demo/proof/network-log | jq
```
**What you'll see**: `outbound_ai_calls: 0`, `copilot_proxy_requests_observed: 0`

**Say**: "Our application tracks every outbound request. Zero AI calls during database operations."

---

### Demo Part 3: Content Exclusion (5 minutes)

**Step 10 — Show `.copilotignore`**

Open `.copilotignore` in VS Code:
```
*.db
*.sqlite
*.sqlite3
data/**
```

**Say**: "Even at design time, we block Copilot from indexing database files. This is the local-level control."

**Step 11 — Show org-level content exclusion**

Navigate to GitHub → Repository Settings → Copilot → Content Exclusion.

**Say**: "For enterprise, admins can enforce this at the org level. Developers cannot override it."

**Step 12 — Show the slashed icon**

Open `data/citizens.db` in VS Code (or any excluded file pattern).

**What you'll see**: The Copilot icon in the status bar shows a slash through it.

**Say**: "Visual confirmation: Copilot is completely disabled for this file."

---

### Demo Part 4: Secret Handling in Agent Mode (5 minutes)

**Step 13 — Show environment scoping**

Navigate to GitHub → Repository Settings → Environments → Show the `copilot` environment.

**Say**: "In agent mode, secrets aren't inherited automatically. You must explicitly add them to the Copilot environment. This prevents accidental exposure."

**Step 14 — Show the architecture diagram**

Open `http://localhost:3000` → Copilot Security tab → Interactive Data Flow.

Click each node to see the proof:
- **Developer Prompt**: Shows what you type
- **Copilot Extension**: Runs `nslookup copilot-proxy.githubusercontent.com` to prove the single endpoint
- **GitHub Proxy**: Shows the `x-model-version` header proving which model is used
- **Model Providers**: Shows ZDR agreement details
- **Response**: Shows the stateless test (pineapple42)

---

## Curveball Questions & Answers

### "What if someone puts an SSN directly in a prompt?"

**Answer**: The prompt (including the SSN) is sent to the model, processed, and the response is returned. For Business/Enterprise plans, the prompt is **discarded after the response** — it is never stored, never logged (beyond the optional 30-day abuse monitoring window, which enterprises can opt out of), and never used for training. The SSN exists in transit only, encrypted with TLS 1.2+.

**Risk level**: Low. Same as typing an SSN into any HTTPS web form. The real mitigation is training developers not to paste PII into prompts — same as training them not to paste PII into Google searches.

### "What about the 30-day abuse monitoring logs?"

**Answer**: Azure OpenAI models store prompts for up to 30 days for abuse monitoring by default. **Enterprise customers can opt out** by requesting "Modified Abuse Monitoring" from Microsoft. Claude models (via Anthropic) have **Zero Data Retention** — no 30-day window applies.

### "Can Copilot be prompt-injected to exfiltrate data?"

**Answer**: This is why `copilot-instructions.md` is explicitly labeled "NOT a security boundary." The defense is **not** in the instructions — it's in the deterministic controls: content exclusion prevents sensitive files from reaching the model, and secret scanning catches anything that slips into code.

### "What about MCP tools calling our internal APIs?"

**Answer**: MCP tools are code you write and control. If your MCP tool calls an internal API and returns raw PII, that PII enters the conversation context. The solution is architectural: your MCP tools should return redacted data, just like any external-facing API should. We demonstrate this exact pattern in our demo with side-by-side safe vs. unsafe MCP tool code.

### "How do we know data isn't being sent somewhere we don't know about?"

**Answer**: Three ways to verify:
1. **Network inspection**: `nslookup copilot-proxy.githubusercontent.com` — all traffic goes to one endpoint
2. **VS Code DevTools**: Network tab shows every request Copilot makes
3. **Response headers**: `x-model-version` header tells you exactly which model (and provider) processed your request

---

## Summary: The Security Stack

```
┌─────────────────────────────────────────────────┐
│  Layer 5: Human Code Review (Final Check)       │
├─────────────────────────────────────────────────┤
│  Layer 4: Instructions (Probabilistic)          │
│  copilot-instructions.md — reduces risk         │
├─────────────────────────────────────────────────┤
│  Layer 3: Secret Scanning + Push Protection     │
│  Deterministic — blocks secrets in commits      │
├─────────────────────────────────────────────────┤
│  Layer 2: Environment Scoping (Agent Mode)      │
│  Deterministic — explicit secret access only    │
├─────────────────────────────────────────────────┤
│  Layer 1: Content Exclusion (Platform-Enforced) │
│  Deterministic — files never reach the model    │
└─────────────────────────────────────────────────┘
```

**The bottom line**: Use deterministic controls for security. Use probabilistic controls for convenience. Never rely on instructions alone. And remember — Copilot is a design-time code assistant, not a runtime data processor.

---

## Sources & References

1. [GitHub Docs: Content Exclusion](https://docs.github.com/en/copilot/concepts/context/content-exclusion)
2. [GitHub Blog: Content Exclusion GA](https://github.blog/changelog/2024-11-12-content-exclusion-ga/)
3. [GitHub Docs: Customize Agent Environment](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-environment)
4. [GitHub Docs: Custom Agents Configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration)
5. [GitHub Docs: Enhance Agent Mode with MCP](https://docs.github.com/en/copilot/tutorials/enhance-agent-mode-with-mcp)
6. [Microsoft Learn: Resolve Secret Scanning Alerts with Copilot](https://learn.microsoft.com/en-us/training/modules/resolve-github-secret-scanning-alerts-github-copilot-agent/)
7. [GitGuardian: GitHub Copilot Privacy Risks](https://blog.gitguardian.com/github-copilot-security-and-privacy/)
8. [Copilot Content Exclusions: Four Layers of Defense](https://blog.cloud-eng.nl/2026/03/13/copilot-content-exclusions-four-layers/)
9. [GitHub Community: Using Secrets in Copilot Agent Environment](https://github.com/orgs/community/discussions/180346)

---

*Generated for customer demo preparation — GitHub Copilot PII Security POC*
*Demo repository: https://github.com/sautalwar/ghcopilot-pii-demo*
