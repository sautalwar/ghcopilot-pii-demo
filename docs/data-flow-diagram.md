# Data Flow Diagram — GitHub Copilot & PII Security

## Flow 1: Normal Copilot Code Completion (SAFE ✅)

```
Developer writes code          VS Code Copilot Extension         GitHub Copilot Proxy          Azure OpenAI
      │                              │                                  │                          │
      │  Types: "async function      │                                  │                          │
      │  getCitizenBySSN("           │                                  │                          │
      │──────────────────────────────▶│                                  │                          │
      │                              │  Sends: code context (~KB)       │                          │
      │                              │  from open file + neighbors      │                          │
      │                              │─────────────────────────────────▶│                          │
      │                              │                                  │  Forward to LLM          │
      │                              │                                  │─────────────────────────▶│
      │                              │                                  │                          │
      │                              │                                  │  Return: code suggestion │
      │                              │                                  │◀─────────────────────────│
      │                              │  Return suggestion               │                          │
      │                              │◀─────────────────────────────────│                          │
      │  Shows: function signature   │                                  │                          │
      │  suggestion                  │                                  │                          │
      │◀──────────────────────────────│                                  │                          │

  ✅ What was sent: CODE PATTERNS (function name, parameter types)
  ✅ What was NOT sent: Database contents, SSN values, runtime data
  ✅ Retention: ZERO (Business/Enterprise)
```

## Flow 2: Copilot Chat with @workspace (MODERATE RISK 🟡)

```
Developer asks Copilot Chat     VS Code Extension               GitHub Proxy                   Azure OpenAI
      │                              │                                  │                          │
      │  "How does the SSN           │                                  │                          │
      │   redaction work?"           │                                  │                          │
      │──────────────────────────────▶│                                  │                          │
      │                              │  Gathers context:               │                          │
      │                              │  - redaction-service.ts          │                          │
      │                              │  - citizen.ts (types)            │                          │
      │                              │  - copilot-instructions.md       │                          │
      │                              │                                  │                          │
      │                              │  Sends: prompt + file contents   │                          │
      │                              │─────────────────────────────────▶│                          │
      │                              │                                  │─────────────────────────▶│
      │                              │                                  │◀─────────────────────────│
      │                              │◀─────────────────────────────────│                          │
      │  Shows: explanation of       │                                  │                          │
      │  redaction logic             │                                  │                          │
      │◀──────────────────────────────│                                  │                          │

  ✅ What was sent: SOURCE CODE files (redaction logic, types)
  ⚠️ Risk: If source files contain hardcoded PII (e.g., test fixtures), that PII IS sent
  ✅ Mitigation: Content exclusion to block sensitive files
```

## Flow 3: Agent Mode + MCP Tool Call (HIGH RISK ⚠️ without mitigation)

```
Developer asks agent mode       VS Code Extension               MCP Server (YOUR CODE)         Azure OpenAI
      │                              │                                  │                          │
      │  "Find John Doe in           │                                  │                          │
      │   the citizens DB"           │                                  │                          │
      │──────────────────────────────▶│                                  │                          │
      │                              │  Agent decides to call           │                          │
      │                              │  MCP tool: search_citizens       │                          │
      │                              │─────────────────────────────────▶│                          │
      │                              │                                  │                          │
      │                              │  MCP returns: citizen record     │                          │
      │                              │  including SSN: 123-45-6789      │                          │
      │                              │◀─────────────────────────────────│                          │
      │                              │                                  │                          │
      │                              │  ⚠️ SSN is now in LLM context   │                          │
      │                              │─────────────────────────────────────────────────────────────▶│
      │                              │                                  │                          │
      │                              │◀─────────────────────────────────────────────────────────────│
      │  Shows: "John Doe,           │                                  │                          │
      │   SSN: 123-45-6789"          │                                  │                          │
      │◀──────────────────────────────│                                  │                          │

  ⚠️ What was sent: ACTUAL PII DATA (SSN, DOB, email) from the MCP server output
  ⚠️ Risk: The LLM processed the SSN. It's in the 30-day abuse monitoring log.
  ✅ Mitigation: Use REDACTED MCP server — mask PII BEFORE returning to the LLM
```

## Flow 4: Agent Mode + REDACTED MCP Tool Call (MITIGATED ✅)

```
Same flow as above, but MCP server returns:
  {
    "name": "John Doe",
    "ssn": "***-**-6789",         ← masked by YOUR code
    "email": "j***@example.com",  ← masked by YOUR code
    "phone": "(***) ***-4567"     ← masked by YOUR code
  }

  ✅ The LLM never sees the real SSN
  ✅ The abuse monitoring log only contains masked values
  ✅ The developer gets useful results without PII exposure
```

## Flow 5: Local AI Processing (ZERO CLOUD EXPOSURE ✅)

```
Application code                 Local Ollama Instance           SQL Server (local)
      │                              │                                  │
      │  Query citizens table        │                                  │
      │─────────────────────────────────────────────────────────────────▶│
      │  Returns: full PII records   │                                  │
      │◀─────────────────────────────────────────────────────────────────│
      │                              │                                  │
      │  Send records to local AI    │                                  │
      │  "Summarize demographics"    │                                  │
      │──────────────────────────────▶│                                  │
      │                              │                                  │
      │  Local AI processes data     │                                  │
      │  entirely on THIS machine    │                                  │
      │                              │                                  │
      │  Returns: summary            │                                  │
      │◀──────────────────────────────│                                  │

  ✅ Network traffic to cloud: ZERO
  ✅ PII never leaves the machine
  ✅ No abuse monitoring logs, no retention concerns
  ⚠️ Trade-off: local models are less capable than cloud models
```
