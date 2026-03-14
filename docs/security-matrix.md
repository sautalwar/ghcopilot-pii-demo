# Security Matrix — GitHub Copilot & PII Data

## Quick Reference: What's Secure and What's Not

### ✅ SECURE — Data Does NOT Leave Your Control

| Scenario | Why It's Secure | Evidence |
|---|---|---|
| Writing code with Copilot tab-complete | Only code context (~KB around cursor) is sent. Database contents, runtime data, terminal output are NEVER sent. | [GitHub Privacy Notice](https://docs.github.com/en/copilot/responsible-use-of-github-copilot-features/github-copilot-general-privacy-notice) |
| Copilot Chat about code logic | Only source code you reference (#file, @workspace, selected text) is sent. Live DB data is not accessible. | [Life of a Prompt (Microsoft Blog)](https://devblogs.microsoft.com/all-things-azure/github-copilot-chat-explained-the-life-of-a-prompt/) |
| Business/Enterprise prompt retention | Zero data retention. Prompts discarded after response. | [Copilot Trust Center](https://resources.github.com/copilot-trust-center/) |
| Model training on your data | Business/Enterprise: contractually prohibited. Your code/prompts are NEVER used for training. | [GitHub Copilot for Business Privacy](https://docs.github.com/en/copilot/responsible-use-of-github-copilot-features/github-copilot-general-privacy-notice) |
| Content exclusion | Admins can block specific files/dirs from Copilot context. Enforced across completions, Chat, and reviews. | [Content Exclusion (GA)](https://github.blog/changelog/2024-11-12-content-exclusion-ga/) |
| Local AI (Ollama) processing | Data stays 100% on your machine. Zero network traffic to cloud AI. | Demonstrable via network monitoring |
| REDACTED MCP server | YOUR code masks PII before it reaches the LLM. Deterministic, enforceable. | POC demo (this project) |
| Column-level encryption (Always Encrypted) | Even raw DB access yields encrypted values without the key. | [SQL Server Always Encrypted](https://learn.microsoft.com/en-us/sql/relational-databases/security/encryption/always-encrypted-database-engine) |

### ⚠️ NOT SECURE — Data May Be Exposed

| Scenario | Why It's Risky | Mitigation |
|---|---|---|
| Developer pastes PII into Chat | Human copies SSNs from DB results into Copilot Chat → PII sent to cloud | Training, policies, DLP tools |
| RAW MCP server tool calls | MCP server returns unredacted PII → LLM sees it → in abuse monitoring logs | Use REDACTED MCP server |
| copilot-instructions.md rules | Best-effort only. LLM may ignore "never output SSNs". NOT deterministic. | Use code-level controls instead |
| @workspace with sensitive files | If repo contains hardcoded secrets/PII in source files, they're sent as context | Content exclusion, .gitignore, secret scanning |
| Azure OpenAI abuse monitoring | Prompts stored for 30 days by default for abuse detection | Enterprise opt-out ("Modified Abuse Monitoring") |
| Prompt injection attacks | Malicious content in repos could craft prompts that leak data | Code review, input validation, security scanning |
| Third-party Copilot Extensions | Extensions have their own data handling policies | Vet extensions, use only trusted ones |

### 🔶 NUANCES — Depends on Configuration

| Scenario | Detail | Action |
|---|---|---|
| Individual plan web/mobile | Prompts may be stored up to 28 days | Use Business/Enterprise for sensitive work |
| Telemetry data | Usage metrics (no code content) stored up to 1 year | Org admin can review what's collected |
| Audit logs | Enterprise audit shows who/when, NOT prompt content | Enable for compliance tracking |
| IP indemnity | Business/Enterprise includes IP protection | This is about copyright, not data security |
| Sub-processor chain | GitHub → Azure OpenAI. Microsoft DPA applies. | Review Microsoft's DPA for your contract |

## Decision Framework: When to Use What

```
┌─────────────────────────────────────────────────┐
│  QUESTION: Does the task involve PROCESSING     │
│  sensitive data (PII, SSNs, credentials)?       │
└──────────────────┬──────────────────────────────┘
                   │
          ┌────────┴────────┐
          │                 │
          ▼                 ▼
    ┌──────────┐     ┌──────────────┐
    │   YES    │     │     NO       │
    └────┬─────┘     └──────┬───────┘
         │                  │
         ▼                  ▼
   Use LOCAL AI        Use GitHub Copilot
   (Ollama/Foundry)    (Chat, completions,
   for DATA processing  agent mode with
                        REDACTED MCP servers)
```

## Layered Security Model

```
Layer 1: Content Exclusion     → Block sensitive files from Copilot context
Layer 2: Redacted MCP Servers  → Mask PII before it reaches the LLM
Layer 3: Application Redaction → Mask PII in API responses
Layer 4: Column Encryption     → Encrypt PII at rest in database
Layer 5: Audit Logging         → Track all PII access events
Layer 6: Local AI              → Process highest-sensitivity data locally
Layer 7: Developer Training    → Don't paste PII into Chat
Layer 8: Enterprise Opt-out    → Zero retention for abuse monitoring logs
Layer 9: Model Selection       → Choose model based on sensitivity + retention posture
```

## Multi-Model Security Summary

| Model | Provider | Retention | Abuse Log Retention | 1M Context? |
|---|---|---|---|---|
| Claude Sonnet 4/4.6 | Anthropic | ZDR (zero) | 7 days (ZDR via Copilot) | ✅ 1,000,000 tokens |
| Claude Opus 4/4.6 | Anthropic | ZDR (zero) | 7 days (ZDR via Copilot) | 200K (1M TBD) |
| GPT-4.1 | Azure OpenAI | Zero (Biz/Ent) | 30 days (opt-out available) | 1,000,000 tokens |
| GPT-5 | Azure OpenAI | Zero (Biz/Ent) | 30 days (opt-out available) | 400,000 tokens |
| Gemini 2.5/3 Pro | Google Cloud | Zero (CDPA) | Google Cloud terms | 2,000,000 tokens |

**See `docs/multi-model-security.md` for full analysis, data flow diagrams, and 1M context window security implications.**

## Sources & Official Documentation

| Resource | URL |
|---|---|
| GitHub Copilot Trust Center | https://resources.github.com/copilot-trust-center/ |
| GitHub Copilot Privacy Notice | https://docs.github.com/en/copilot/responsible-use-of-github-copilot-features/github-copilot-general-privacy-notice |
| Content Exclusion Docs | https://docs.github.com/en/copilot/how-tos/configure-content-exclusion/exclude-content-from-copilot |
| Azure OpenAI Data Privacy | https://learn.microsoft.com/en-us/legal/cognitive-services/openai/data-privacy |
| Demystifying Copilot Security | https://techcommunity.microsoft.com/blog/azuredevcommunityblog/demystifying-github-copilot-security-controls-easing-concerns-for-organizational/4468193 |
| Life of a Prompt (Blog) | https://devblogs.microsoft.com/all-things-azure/github-copilot-chat-explained-the-life-of-a-prompt/ |
| Model Hosting for Copilot | https://docs.github.com/en/copilot/reference/ai-models/model-hosting |
| Copilot Audit Logs | https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-for-organization/review-activity/review-audit-logs |
| Anthropic as Microsoft Sub-processor | https://learn.microsoft.com/en-us/copilot/microsoft-365/connect-to-ai-subprocessor |
| Anthropic Zero Data Retention (API) | https://platform.claude.com/docs/en/build-with-claude/zero-data-retention |
| Anthropic Data Retention FAQ | https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data |
| Claude Sonnet 4 1M Context | https://www.anthropic.com/news/1m-context |
| Google Cloud Gemini Data Governance | https://docs.cloud.google.com/gemini/docs/discover/data-governance |
| Configure Model Access (Enterprise) | https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/use-ai-models/configure-access-to-ai-models |
