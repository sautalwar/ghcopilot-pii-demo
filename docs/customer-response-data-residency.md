# Complete Customer Response: Data Residency, Logs, Sessions & Instruction Files

## Addressing Every Customer Question — With Working Examples

---

## Question 1: "What about connecting Copilot to a system or database with private information?"

### The Direct Answer

**Standard Copilot Chat cannot connect to any database.** It is a design-time code assistant that reads your source code files. It has no ability to execute code, open network connections, or run SQL queries.

When you give Copilot MCP (Model Context Protocol) tools that CAN query a database, whatever the tool returns enters the conversation context. The precaution: **redact PII inside the tool before data reaches the model.**

### Three Scenarios Explained

| Scenario | Can Copilot See DB Data? | Why? |
|---|---|---|
| Copilot Chat (no MCP) | **NO** | Copilot reads code, not databases |
| Your app queries DB | **NO** | Copilot is not in the data path |
| MCP tool queries DB | **Only what the tool returns** | You control the tool output |

### Live Demo Proof

```bash
# Start the demo server
cd ghcopilot-pii-demo && npx ts-node src/server.ts

# 1. Show raw PII exists in DB
curl http://localhost:3000/api/pii-demo/citizens/raw | jq '.data[0].ssn'
# Returns: "000-11-1201"

# 2. Show redacted endpoint masks it
curl http://localhost:3000/api/pii-demo/citizens | jq '.data[0].ssn'
# Returns: "***-**-1201"

# 3. Ask Copilot: "What SSNs are in the citizens database?"
# Result: Copilot can't answer — it doesn't see the data

# 4. Canary Test: "Is there a citizen named Canary Testbird?"
# Copilot: doesn't know. App: finds it instantly.
curl http://localhost:3000/api/pii-demo/search?q=Canary | jq '.data[0]'
```

---

## Question 2: "MD files are suggestions and non-deterministic — only followed 50-80% of the time"

### The Honest Answer: The Customer Is Partially Right

**Yes, instruction files are probabilistic, not deterministic.** GitHub's own documentation explicitly states this. There is no published peer-reviewed study giving exact compliance rates, but the customer's observation aligns with real-world experience.

### What GitHub Officially Says

> "Copilot's behavior is non-deterministic. Instructions are additional context to bias output, not hard constraints or rules."
> — [GitHub Docs: Custom Instructions](https://docs.github.com/en/copilot/tutorials/use-custom-instructions)

### Factors That Affect Compliance

| Factor | Impact on Compliance |
|---|---|
| Instruction length < 4000 chars | Higher compliance |
| Instructions > 1000 lines | "Inconsistent behavior" |
| Clear, specific, imperative phrasing | Better compliance |
| Conflicting or ambiguous instructions | Worse compliance |
| Too many instructions at once | Model "skips" some |

### The Framework: Don't Rely on Instructions for Security

| Control | Type | Reliability | Use For |
|---|---|---|---|
| Content Exclusion (org settings) | **Deterministic** | 100% enforced | Blocking files from reaching the model |
| Secret Scanning + Push Protection | **Deterministic** | 100% enforced | Catching secrets in commits |
| `.copilotignore` | **Deterministic** | 100% enforced | Local file exclusion |
| Environment Scoping (agent mode) | **Deterministic** | 100% enforced | Limiting secret access |
| `copilot-instructions.md` | **Probabilistic** | ~70-90% (varies) | Guiding code style, patterns |

### How to Demo This

```
Step 1: Create .github/copilot-instructions.md with:
  "Never suggest console.log() — always use logger.info() instead"

Step 2: Ask Copilot: "Write a function that fetches user data and logs the result"

Step 3: Check — did it use console.log or logger.info?

Step 4: Repeat 10 times. Track compliance rate.

Step 5: Show content exclusion as the DETERMINISTIC alternative
  → Add *.env to content exclusion
  → Open .env file → Copilot icon shows slash
  → This is 100% enforced, every time, no exceptions
```

### Key Talking Point

> "The customer is right that instructions aren't 100% reliable. That's why we NEVER rely on them for security. We use deterministic controls (content exclusion, secret scanning, environment scoping) for security, and instructions for code quality guidance. It's defense in depth — instructions are one layer, not the only layer."

---

## Question 3: "Where does data end up in the debugging path, in the logs?"

### Complete Data Residency Map

#### On the Developer's Machine

| Location | What's Stored | Retention | Path |
|---|---|---|---|
| VS Code Chat History | Conversation sessions (SQLite) | **Until manually deleted** | `%APPDATA%\Code\User\workspaceStorage\<id>\state.vscdb` |
| VS Code User Memory | Cross-workspace memories | Until manually deleted | `%APPDATA%\Code\User\globalStorage\` |
| VS Code Repo Memory | Workspace-specific memories | Until manually deleted | Part of workspace storage |
| VS Code Output Panel | Copilot debug logs | **Until VS Code restart** (ephemeral) | View → Output → "GitHub Copilot" |
| VS Code Extension Logs | Extension activation, errors | Rotated by VS Code | `%APPDATA%\Code\logs\<date>\exthost\` |
| Shell History | CLI prompts (`gh copilot`) | Until cleared | PowerShell: `(Get-PSReadLineOption).HistorySavePath` |
| SQLite Database | Runtime application data | **Permanent until deleted** | `data/citizens.db` |
| `.env` files | Secrets, tokens | Permanent until deleted | Project root |

#### On GitHub/Microsoft Servers

| Location | What's Stored | Retention | Opt-Out? |
|---|---|---|---|
| github.com Web Chat | Conversation history | **30 days auto-delete** | No manual delete; export available |
| GitHub Usage Metrics | Activity timestamps (NOT content) | **90 days rolling** | N/A |
| Azure OpenAI Abuse Monitoring | Prompts (for abuse detection) | **30 days** | **YES** — "Modified Abuse Monitoring" |
| Anthropic (Claude models) | **Nothing** (Zero Data Retention) | **0 days** | N/A — already zero |
| GitHub Telemetry | Feature usage, errors, timing | Configurable | VS Code telemetry settings |

#### MCP-Specific

| Location | What's Stored | Retention | Who Controls It? |
|---|---|---|---|
| MCP Server Process | Tool call inputs/outputs in memory | Until process stops | You |
| MCP Server Logs | Whatever you log | Your code controls this | You |
| Copilot Context | Tool outputs (in conversation) | Session duration | Discarded after session |

### How to Inspect Each Location

```powershell
# 1. Find VS Code chat history (SQLite database)
$wsPath = "$env:APPDATA\Code\User\workspaceStorage"
Get-ChildItem $wsPath -Recurse -Filter "state.vscdb" | Select-Object FullName, Length, LastWriteTime

# 2. Check shell history for Copilot CLI usage
$histPath = (Get-PSReadLineOption).HistorySavePath
Select-String -Path $histPath -Pattern "copilot" | Select-Object -Last 5

# 3. Find VS Code extension logs
$logPath = "$env:APPDATA\Code\logs"
Get-ChildItem $logPath -Recurse -Filter "*.log" | Where-Object { $_.Length -gt 0 } | Sort-Object LastWriteTime -Descending | Select-Object -First 10

# 4. Check VS Code telemetry setting
# In VS Code: File → Preferences → Settings → search "telemetry"
# Options: "off", "crash", "error", "all"
```

### How to Clear Each Location

```powershell
# 1. Clear VS Code chat history for a workspace
# Find workspace ID, then delete:
Remove-Item "$env:APPDATA\Code\User\workspaceStorage\<workspace-id>\state.vscdb"

# 2. Clear shell history
Clear-History  # PowerShell
# Or: Remove-Item (Get-PSReadLineOption).HistorySavePath

# 3. Clear VS Code logs
Remove-Item "$env:APPDATA\Code\logs\*" -Recurse -Force

# 4. Delete local SQLite database
Remove-Item "data\citizens.db" -Force
```

---

## Question 4: "What about prompt debugging logs that Microsoft captures?"

### What's in the Debug Logs

**VS Code Output Panel ("GitHub Copilot" channel)** shows:
- ✅ Timestamps of requests
- ✅ Request IDs (UUIDs)
- ✅ Model selection (which model was chosen)
- ✅ Token counts (input/output)
- ✅ Response timing (latency)
- ✅ Error messages and retry logic
- ❌ **NOT** the full prompt text
- ❌ **NOT** the full response text
- ❌ **NOT** your source code content
- ❌ **NOT** any PII or secrets

**VS Code Output Panel ("GitHub Copilot Chat" channel)** shows:
- ✅ Session IDs
- ✅ Tool call names (e.g., "lookup_citizen")
- ✅ Timing data
- ❌ **NOT** tool call arguments or outputs
- ❌ **NOT** conversation content

### What Microsoft Captures Server-Side

For **Business/Enterprise** plans:
- Prompts are processed and **discarded immediately** after response
- No prompts are used for model training
- Usage metrics (timestamps, feature used, model selected) retained 90 days
- Azure OpenAI abuse monitoring: prompts retained up to 30 days (enterprise opt-out available)
- Anthropic Claude: Zero Data Retention — nothing stored

### How to Demo This

```
Step 1: Open VS Code → View → Output
Step 2: Select "GitHub Copilot" from dropdown
Step 3: Ask Copilot Chat: "What is the purpose of this file?"
Step 4: Watch the Output panel — show what appears:
  - "[INFO] Request sent, ID: abc-123, model: gpt-4.1"
  - "[INFO] Response received, 150 tokens, 1.2s"
  - No source code, no prompt text, no response content

Step 5: Open DevTools (Ctrl+Shift+I) → Network tab
Step 6: Repeat the Copilot query
Step 7: Click on the request to copilot-proxy.githubusercontent.com
Step 8: Show:
  - Request URL: copilot-proxy.githubusercontent.com
  - Response header: x-model-version (proves which model)
  - Request body: encrypted (you can't read the prompt)

Step 9: Run nslookup to prove single endpoint:
  nslookup copilot-proxy.githubusercontent.com
  → Shows Microsoft/GitHub IP addresses
```

---

## Question 5: "How long are web-based chat sessions and local sessions stored?"

### Web-Based Chat (github.com)

| Attribute | Value |
|---|---|
| Retention | **30 days** |
| Auto-deletion | **Yes** — conversations auto-expire after 30 days |
| Manual deletion | **No** — no per-conversation delete option |
| Export | **Yes** — export button available to save conversations |
| Access | Visible in github.com → Copilot Chat → History |
| Categories | Today, Yesterday, Last 7 days, Last 30 days |

### Local Sessions (VS Code)

| Attribute | Value |
|---|---|
| Retention | **Indefinite** — until manually deleted |
| Auto-deletion | **No** — there is no auto-expiration |
| Manual deletion | **Yes** — delete state.vscdb or use VS Code commands |
| Export | **Yes** — via Chat: Export Session command or extensions |
| Location | `%APPDATA%\Code\User\workspaceStorage\<id>\state.vscdb` |

### The Customer's Concern About No Auto-Expiration

> "There's no auto expiration."

**This is correct for local VS Code sessions.** Chat history persists locally until the developer manually clears it. The customer should:

1. **Implement a cleanup policy** — script that runs periodically to clear old state.vscdb files
2. **Use VS Code's built-in export** — save important conversations, clear the rest
3. **Understand the risk level** — these files are on the developer's local machine, protected by the same OS-level security as all other local files

```powershell
# Auto-cleanup script: Delete VS Code chat histories older than 30 days
$wsPath = "$env:APPDATA\Code\User\workspaceStorage"
Get-ChildItem $wsPath -Recurse -Filter "state.vscdb" |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
  ForEach-Object {
    Write-Host "Cleaning: $($_.FullName)"
    Remove-Item $_.FullName -Force
  }
```

---

## Question 6: "What is the scope of what the AI agent can see?"

### Complete Visibility Map

```
┌─────────────────────────────────────────────────────────────┐
│                    COPILOT CAN SEE                          │
├─────────────────────────────────────────────────────────────┤
│  • Open files in VS Code editor                             │
│  • Files in workspace (non-excluded)                        │
│  • @workspace indexed files                                 │
│  • Terminal output (if using @terminal)                     │
│  • MCP tool outputs (whatever the tool returns)             │
│  • copilot-instructions.md content                          │
│  • Git diff/history (if using @git)                         │
│  • Environment variable NAMES (not always values)           │
│  • File names and directory structure                        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                 COPILOT CANNOT SEE                           │
├─────────────────────────────────────────────────────────────┤
│  • Content-excluded files (deterministic block)             │
│  • .copilotignore'd files                                   │
│  • Database contents (runtime data)                         │
│  • Network responses from your running app                  │
│  • Environment variable VALUES at runtime                   │
│  • Files not in the workspace                               │
│  • Other users' code or conversations                       │
│  • Files on remote servers unless explicitly shared          │
│  • Secrets in GitHub Environments (unless explicitly added)  │
└─────────────────────────────────────────────────────────────┘
```

### What Happens When Copilot DOES See Something It Shouldn't

The customer asks: "What is the impact when it does?"

**Impact Assessment:**

| What Copilot Sees | Where It Goes | Retention | Impact |
|---|---|---|---|
| SSN in a code comment | Model provider for processing | Discarded after response (Biz/Ent) | **Low** — same as typing in any HTTPS form |
| Password in .env (not excluded) | Model provider for processing | Discarded after response | **Medium** — rotate the password |
| Secret in terminal output | Model context (if @terminal used) | Session only | **Low** — local context only |
| Raw PII from MCP tool | Model provider for processing | Discarded after response | **Medium** — redact in tool |

**Key Point**: For Business/Enterprise, the blast radius is limited because prompts are discarded after response. The data is in-transit only (TLS 1.2+ encrypted), processed, and deleted. It is never stored permanently and never used for training.

---

## Question 7: "We have zero data retention — but where are our risks?"

### Complete Risk Assessment

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| PII in code comment seen by Copilot | Medium | Low (discarded after response) | Content exclusion, code review |
| Secret in .env seen by Copilot | Low (if excluded) | Medium | Content exclusion (deterministic) |
| MCP tool returns raw PII | Medium (if tools poorly designed) | Medium | Redact inside MCP tool |
| Azure OpenAI 30-day abuse log | Low (enterprise opt-out) | Low | Request Modified Abuse Monitoring |
| Local chat history on dev machine | High (always stored) | Low (local file, OS-protected) | Cleanup script, FDE |
| Web chat retained 30 days | Certain | Low (auto-deleted) | Don't paste secrets in web chat |
| Developer pastes SSN in prompt | Low | Low (discarded after response) | Training, instruction files |
| Instruction file ignored | Medium (~20-30% chance) | None if using deterministic controls | Layer deterministic controls |

### The Bottom Line

> "Your biggest risk is not that Copilot leaks data to the cloud — Business/Enterprise plans discard prompts immediately. Your biggest risk is local data residency: chat history persisting on developer machines with no auto-expiration. Implement a cleanup policy and full-disk encryption."

---

## Step-by-Step Demo Setup Guide (For Newbies)

### Prerequisites

1. **Install VS Code**: Download from https://code.visualstudio.com
2. **Install GitHub Copilot**: VS Code Extensions → Search "GitHub Copilot" → Install
3. **Install Node.js**: Download from https://nodejs.org (LTS version)
4. **Install Git**: Download from https://git-scm.com
5. **Sign in to GitHub**: In VS Code, sign in with your GitHub account that has Copilot access

### Setup the Demo (10 minutes)

```powershell
# Step 1: Clone the demo repository
git clone https://github.com/sautalwar/ghcopilot-pii-demo.git
cd ghcopilot-pii-demo

# Step 2: Install dependencies
npm install

# Step 3: Start the server
npx ts-node src/server.ts
# You should see: "Demo orchestration API listening on port 3000"

# Step 4: Open in browser
Start-Process "http://localhost:3000/data-residency-demo.html"
```

### Demo 1: Database Isolation Proof (15 minutes)

Open http://localhost:3000/pii-demo.html

| Step | Action | What You See | What to Say |
|---|---|---|---|
| 1 | Click "Query Database (Raw)" | Table with full SSNs | "This is real PII in our local database" |
| 2 | Click "Query Database (Redacted)" | Masked SSNs `***-**-1234` | "Our app masks PII before returning it" |
| 3 | Open VS Code Chat, type: "What SSNs are in the citizens database?" | Copilot says it can't access the DB | "Copilot reads code, not databases" |
| 4 | Type: "What does getCitizenById do?" | Copilot describes the function | "It knows the CODE but not the DATA" |
| 5 | Click "Search for Canary" | Finds "Canary Testbird" | "The canary exists in the DB but Copilot can't find it" |
| 6 | Ask Copilot: "Is there a citizen named Canary Testbird?" | Copilot doesn't know | "Definitive proof: Copilot is blind to runtime data" |

### Demo 2: Local Storage Inspection (10 minutes)

| Step | Action | What You See | What to Say |
|---|---|---|---|
| 1 | Open PowerShell, run: `explorer "$env:APPDATA\Code\User\workspaceStorage"` | Folder with workspace IDs | "This is where VS Code stores chat history" |
| 2 | Find a `state.vscdb` file, note its size | SQLite database file | "Chat sessions are stored in this SQLite DB" |
| 3 | Run: `sqlite3 state.vscdb ".tables"` (if sqlite3 available) | Table names | "These are the internal tables" |
| 4 | Show file date | Last modified timestamp | "No auto-expiration — this persists until you delete it" |
| 5 | Show the cleanup script from this guide | PowerShell cleanup | "Organizations should implement periodic cleanup" |

### Demo 3: Network Inspection (10 minutes)

| Step | Action | What You See | What to Say |
|---|---|---|---|
| 1 | Open VS Code DevTools: `Ctrl+Shift+I` | DevTools panel | "We'll watch every network request" |
| 2 | Go to Network tab, clear the log | Empty network log | "Clean slate" |
| 3 | Ask Copilot a question | Requests appear | "Every request goes to one endpoint" |
| 4 | Click on the copilot-proxy request | Request details | "All traffic goes through copilot-proxy.githubusercontent.com" |
| 5 | Show Response Headers → `x-model-version` | Model identifier | "This proves which model processed your request" |
| 6 | Run: `nslookup copilot-proxy.githubusercontent.com` | IP addresses | "All resolved to Microsoft/GitHub infrastructure" |

### Demo 4: Debug Log Inspection (10 minutes)

| Step | Action | What You See | What to Say |
|---|---|---|---|
| 1 | VS Code → View → Output | Output panel | "This is where debug logs appear" |
| 2 | Select "GitHub Copilot" from dropdown | Copilot-specific logs | "Let's see what Copilot logs" |
| 3 | Ask Copilot a question | New log entries appear | "Notice: request IDs, timing, token counts" |
| 4 | Search for any SSN pattern in the logs | No matches | "No PII in the logs — only metadata" |
| 5 | Search for your prompt text | No matches | "Your prompt text is NOT logged locally either" |

### Demo 5: Instruction Compliance Test (10 minutes)

| Step | Action | What You See | What to Say |
|---|---|---|---|
| 1 | Create `.github/copilot-instructions.md` with "Never use console.log" | File created | "This is a probabilistic instruction" |
| 2 | Ask Copilot to write a logging function | May or may not use console.log | "Let's test compliance" |
| 3 | Repeat 5 times, track results | ~3-4 out of 5 comply | "Instructions are followed most of the time, but not always" |
| 4 | Add `*.env` to Content Exclusion in GitHub org settings | Setting saved | "NOW let's show deterministic control" |
| 5 | Open `.env` file | Slashed Copilot icon | "100% enforced, every time, no exceptions" |
| 6 | Ask about `.env` contents | Copilot can't answer | "THIS is what you use for security" |

### Demo 6: MCP Tool Redaction (10 minutes)

| Step | Action | What You See | What to Say |
|---|---|---|---|
| 1 | Show `src/pii-demo/pii-routes.ts` | Safe endpoint code with masking | "This is the safe pattern — redact before returning" |
| 2 | Call redacted endpoint | Masked data | "MCP tools should follow this pattern" |
| 3 | Show unsafe endpoint code | No masking | "This is what NOT to do" |
| 4 | Call raw endpoint | Full PII visible | "If an MCP tool returns this, Copilot sees it all" |
| 5 | Show side-by-side comparison | Safe vs unsafe | "You control what the tool returns" |

---

## Sources & References

1. [GitHub Docs: Content Exclusion](https://docs.github.com/en/copilot/concepts/context/content-exclusion)
2. [GitHub Docs: Viewing Copilot Logs](https://docs.github.com/en/copilot/how-tos/troubleshoot-copilot/view-logs?tool=vscode)
3. [GitHub Docs: Custom Instructions](https://docs.github.com/en/copilot/tutorials/use-custom-instructions)
4. [GitHub Blog: Copilot Code Review Instructions](https://github.blog/ai-and-ml/unlocking-the-full-power-of-copilot-code-review-master-your-instructions-files/)
5. [GitHub Docs: Metrics Data Properties](https://docs.github.com/en/copilot/reference/metrics-data)
6. [GitHub Docs: Model Hosting](https://docs.github.com/en/copilot/reference/ai-models/model-hosting)
7. [VS Code Docs: Telemetry](https://code.visualstudio.com/docs/configure/telemetry)
8. [VS Code Docs: Memory in Agents](https://code.visualstudio.com/docs/copilot/agents/memory)
9. [GitHub Community: Chat History Location](https://github.com/orgs/community/discussions/69740)
10. [Azure OpenAI Data Retention](https://learn.microsoft.com/en-us/answers/questions/2181252/azure-openai-data-retention-privacy-2025)
11. [GitHub Community: Web Chat History Retention](https://github.com/orgs/community/discussions/169768)
12. [Copilot Content Exclusions: Four Layers of Defense](https://blog.cloud-eng.nl/2026/03/13/copilot-content-exclusions-four-layers/)

---

*Live demo portal: http://localhost:3000*
*Data residency demo: http://localhost:3000/data-residency-demo.html*
*PII database demo: http://localhost:3000/pii-demo.html*
*Repository: https://github.com/sautalwar/ghcopilot-pii-demo*
