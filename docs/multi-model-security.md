# Multi-Model Security: Claude Sonnet, Opus, Gemini & GPT in GitHub Copilot

## Why This Matters

GitHub Copilot is **multi-model** — users can select Claude Sonnet 4, Claude Opus 4, GPT-4.1, GPT-5, Gemini 2.5/3 Pro, and others. **Each model routes your prompts to a different cloud provider** with different data handling. The customer needs to understand exactly where data goes for EACH model they plan to use.

---

## End-to-End Data Flow by Model Provider

### When You Select Claude Sonnet or Opus

```
Developer (VS Code)
      │
      │  Prompt + code context
      │  (encrypted TLS)
      ▼
┌──────────────────────────┐
│  GitHub Copilot Proxy    │ ← Authentication, rate limiting, content filtering
│  (GitHub Cloud / Azure)  │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  ANTHROPIC               │ ← Sub-processor (AWS / Google Cloud infrastructure)
│  Claude Sonnet 4 / Opus 4│
│                          │
│  • Zero Data Retention   │   (GitHub has ZDR agreement with Anthropic for GA features)
│  • NOT used for training │
│  • Prompt caching may    │   apply (transient, for performance)
│  • Content filtered      │   by GitHub before reaching Anthropic
└──────────┬───────────────┘
           │
           ▼
Response back through GitHub Proxy → VS Code
```

### When You Select GPT (Default)

```
Developer (VS Code)
      │
      ▼
┌──────────────────────────┐
│  GitHub Copilot Proxy    │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  AZURE OPENAI            │ ← Sub-processor (Microsoft Azure infrastructure)
│  GPT-4.1 / GPT-5        │
│                          │
│  • Zero Data Retention   │   (Biz/Enterprise)
│  • NOT used for training │
│  • Abuse monitoring:     │   30-day prompt retention (enterprise opt-out available)
│  • Content filtered      │   by GitHub + Azure
└──────────┬───────────────┘
           │
           ▼
Response back through GitHub Proxy → VS Code
```

### When You Select Gemini

```
Developer (VS Code)
      │
      ▼
┌──────────────────────────┐
│  GitHub Copilot Proxy    │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  GOOGLE CLOUD            │ ← Sub-processor (GCP infrastructure)
│  Gemini 2.5/3 Pro/Flash  │
│                          │
│  • Zero Data Retention   │
│  • NOT used for training │   (Google CDPA applies)
│  • Content filtered      │   by GitHub + Google
└──────────┬───────────────┘
           │
           ▼
Response back through GitHub Proxy → VS Code
```

---

## Security Comparison: Model-by-Model

| Security Aspect | Claude (Anthropic) | GPT (Azure OpenAI) | Gemini (Google Cloud) |
|---|---|---|---|
| **Infrastructure** | AWS / Google Cloud (Anthropic-managed) | Microsoft Azure | Google Cloud Platform |
| **Data retention (via Copilot)** | Zero (GA features). ZDR agreement with GitHub | Zero (Biz/Ent). 30-day abuse monitoring log | Zero. Google CDPA applies |
| **Used for model training?** | ❌ No | ❌ No | ❌ No |
| **Abuse monitoring logs** | Anthropic API: 7 days (post Sep 2025). Via Copilot: covered by ZDR | Azure OpenAI: 30 days (enterprise opt-out) | Not specified; Google CDPA governs |
| **Enterprise opt-out for logs** | ZDR already in place via GitHub agreement | Must apply for "Modified Abuse Monitoring" | Governed by Google Cloud terms |
| **Sub-processor status** | Anthropic is a Microsoft sub-processor (Jan 2026). Microsoft DPA applies | Azure OpenAI is Microsoft's own service | Google is a GitHub sub-processor |
| **EU/EFTA/UK data residency** | ⚠️ Disabled by default in EU/EFTA/UK. Admin must opt-in | Available | Subject to GCP region settings |
| **Admin model controls** | ✅ Can enable/disable per org | ✅ Default model | ✅ Can enable/disable per org |
| **Content filtering** | GitHub proxy filters BEFORE sending to Anthropic | GitHub proxy + Azure content safety | GitHub proxy + Google safety |
| **Prompt caching** | May apply (transient, performance only) | May apply (transient) | May apply (transient) |

### Sources

| Resource | URL |
|---|---|
| GitHub Model Hosting Docs | https://docs.github.com/en/copilot/reference/ai-models/model-hosting |
| Anthropic as Microsoft Sub-processor | https://learn.microsoft.com/en-us/copilot/microsoft-365/connect-to-ai-subprocessor |
| Anthropic Data Retention (API) | https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data |
| Anthropic Zero Data Retention | https://platform.claude.com/docs/en/build-with-claude/zero-data-retention |
| Azure OpenAI Data Privacy | https://learn.microsoft.com/en-us/legal/cognitive-services/openai/data-privacy |
| Google Cloud Gemini Data Governance | https://docs.cloud.google.com/gemini/docs/discover/data-governance |
| Configure Model Access (Enterprise) | https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/use-ai-models/configure-access-to-ai-models |
| Claude Sonnet 4 / Opus 4 GA in Copilot | https://github.blog/changelog/2025-06-25-anthropic-claude-sonnet-4-and-claude-opus-4-are-now-generally-available-in-github-copilot/ |

---

## The 1 Million Token Context Window — What It Is and Why It Matters for Security

### What Is It?

Claude Sonnet 4 (and Sonnet 4.6) supports a **1 million token context window** — up from the previous 200K limit. This is the amount of text the model can "see" in a single prompt/conversation.

### How Big Is 1 Million Tokens?

| Metric | Approximate Equivalent |
|---|---|
| Words | ~750,000 words |
| Pages of text | ~2,500 pages |
| Lines of code | ~75,000–110,000 lines |
| Files | An entire medium-to-large codebase in a single prompt |

### Context Window Comparison Across Models (2025–2026)

| Model | Context Window | Available in Copilot? |
|---|---|---|
| **Claude Sonnet 4 / 4.6** | **1,000,000 tokens** | ✅ Yes |
| **Claude Opus 4 / 4.6** | 200,000 tokens (1M TBD) | ✅ Yes |
| **GPT-5** | 400,000 tokens | ✅ Yes |
| **GPT-4.1** | 1,000,000 tokens | ✅ Yes |
| **Gemini 2.5 Pro** | 2,000,000 tokens | ✅ Yes |
| **Gemini 3 Pro** | 2,000,000 tokens | ✅ Yes (Preview) |

**Source**: [Anthropic: Claude Sonnet 4 1M Context](https://www.anthropic.com/news/1m-context), [GitHub Blog: Claude in Copilot](https://github.blog/changelog/2025-06-25-anthropic-claude-sonnet-4-and-claude-opus-4-are-now-generally-available-in-github-copilot/)

### Why This Matters for the Customer

#### The Benefit 🟢
With 1M tokens, Copilot using Claude Sonnet can analyze an **entire codebase** in one conversation:
- Full cross-file understanding (not just the open file)
- Better refactoring suggestions across dozens of files
- More accurate code review with full project context
- Agent mode can reason over entire repos, not just snippets

#### The Security Implication ⚠️

> **More context = more data in the prompt = larger blast radius if PII is present**

| Risk Factor | Detail |
|---|---|
| **More files sent** | With 1M tokens, @workspace may send significantly more files — including ones with secrets, PII in test fixtures, or sensitive configs |
| **Entire repo exposure** | A full codebase send means commit history comments, error messages, sample data, and internal documentation may all enter the prompt |
| **Bigger abuse monitoring log** | If 1M tokens of context includes PII, that entire payload sits in the abuse monitoring log (30 days for Azure OpenAI; ZDR for Anthropic via Copilot) |
| **Cost of mistakes** | A single accidental inclusion of a sensitive file affects 5x more data than the old 200K limit |

#### Mitigations for 1M Context Window

1. **Content exclusion is MORE important than ever**
   - With larger context windows, Copilot can pull in more files
   - Ensure ALL sensitive files are excluded: `.env`, `*.seed.sql`, `**/secrets/**`, test fixtures with PII
   - Review exclusion rules regularly as codebase grows

2. **Redacted MCP servers remain the hard boundary**
   - Even with 1M tokens, MCP server output is what you control
   - If the MCP server masks PII, the 1M-token prompt is PII-free

3. **Review what @workspace sends**
   - Larger context = more files indexed
   - Use `.copilotignore` or content exclusion to limit scope

4. **Local AI for large-scale PII analysis**
   - If you need to analyze 75K+ lines of code that contains PII, use local Ollama instead
   - Don't send an entire PII-containing codebase to a cloud model

### Demo Script G: "1M Context Window — Power and Responsibility"

```
STEP 1: Show Copilot Chat model selector → Select "Claude Sonnet 4"
        → Point out: this model supports 1M tokens of context

STEP 2: Open a large project (or this POC with all files)
        → Use @workspace and ask: "Explain the overall architecture of this project"
        → Claude Sonnet analyzes ALL files across the repo in one pass
        → ✅ Show: comprehensive understanding across all files

STEP 3: Now demonstrate the risk:
        → Create a test fixture file: test/fixtures/sample-citizens.json
        → Include synthetic SSNs in it (fake data)
        → Use @workspace again: "What test data do we have?"
        → ⚠️ Show: Claude Sonnet found and referenced the SSNs from the fixture
        → Point out: with 1M tokens, MORE files are indexed and sent

STEP 4: Apply content exclusion:
        → Add pattern: test/fixtures/**
        → Reload VS Code, repeat the @workspace query
        → ✅ Show: Claude Sonnet no longer references the fixture file

STEP 5: Explain to customer:
        → "The 1M context window is incredibly powerful for understanding
           your entire codebase. But it also means more data is sent to the
           model per prompt. Content exclusion is your primary control —
           it's MORE important with larger context windows, not less."

STEP 6: Compare with GPT-5 (400K tokens) and Claude Opus (200K tokens):
        → Show that smaller context windows send less data per prompt
        → But also provide less comprehensive analysis
        → TAKEAWAY: Choose your model based on task sensitivity + scope needed
```

---

## Key Takeaway for the Customer

> **The 1M context window is real and genuinely useful** — it lets AI understand your entire codebase in one pass.
> But it's a **double-edged sword for security**: more context means more potential exposure.
>
> The answer isn't to avoid large context windows — it's to ensure your **content exclusion rules, MCP redaction, and data hygiene** scale up to match.
>
> **All model providers** (Anthropic, OpenAI, Google) have zero-retention agreements with GitHub for Business/Enterprise.
> The differences are in abuse monitoring retention and regional availability.
> Anthropic's ZDR via Copilot is arguably the strongest position currently.
