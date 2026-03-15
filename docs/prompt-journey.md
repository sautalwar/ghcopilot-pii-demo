# Prompt Journey: How a Copilot Prompt Moves Through the System

## 1. Simple Explanation of the Data Flow

Think of GitHub Copilot like a **secure corporate mail room with approved couriers**.

A developer writes a question in VS Code, the CLI, or a pull request. That question is like a letter being dropped into the company mail room. Before the letter leaves the building, the Copilot extension checks what approved project context should travel with it. It then seals the package and sends it over **TLS**, which is the digital equivalent of a locked, tamper-resistant courier bag.

That package does **not** go straight to OpenAI, Anthropic, or Google. It first goes to the **GitHub Copilot Proxy**, which acts like the company’s secure mail room supervisor. This is where GitHub handles authentication, policy checks, filtering, and audit controls. In other words, GitHub decides whether the request is allowed, what it can include, and where it should go next.

After that, GitHub routes the request to an approved model provider, such as:

- **Azure OpenAI** for models like GPT-4.1 or GPT-5
- **Anthropic** for Claude Sonnet or Claude Opus
- **Google Cloud** for Gemini

Once the model generates an answer, the answer comes **back through GitHub’s policy layer first**. That means GitHub remains the intermediary on the return trip too. Only then is the answer delivered back into the user experience in VS Code, the CLI, or a pull request.

The most important security lesson is this: **whatever reaches the model becomes model context**. If an MCP server or an internal application returns raw PII, that sensitive data can be included in the prompt package sent upstream. The safe pattern is to **redact sensitive data in the MCP server or app layer before it ever reaches the model**.

### A one-paragraph executive summary

A developer’s prompt starts locally, is packaged by the Copilot extension with approved repository context, sent securely to GitHub’s Copilot Proxy, reviewed by GitHub controls, routed by GitHub to an approved model provider, and then returned through GitHub’s policy layer before the user sees the answer. GitHub is the controlled broker in the middle. The main risk is not the network path itself, but **what data your own tools place into the prompt before GitHub sends it onward**.

### 5 key takeaways

1. **GitHub is the front door.** Prompts go to GitHub’s Copilot Proxy first, not directly from the developer to OpenAI, Anthropic, or Google.
2. **The connection is encrypted.** The prompt and approved context travel over TLS.
3. **GitHub applies controls in the middle.** Authentication, policy, filtering, and audit happen at the proxy layer.
4. **Model providers only see what is sent onward.** If raw PII is included by your tools or MCP server, it can become part of model context.
5. **The best mitigation is upstream redaction.** Remove or mask sensitive data before it reaches Copilot or the model.

---

## 2. Step-by-Step Demo: Tracing the Prompt Journey

This demo is designed so a presenter can **show each hop in the data flow** and explain the security meaning of what the audience is seeing.

### Before you start

Prepare the environment first:

- Sign in to GitHub Copilot in VS Code
- Make sure Copilot Chat is enabled
- Use a safe demo repository with no real secrets
- If possible, use an enterprise test org for the audit log step
- Have PowerShell open beside VS Code
- If you plan to show the MCP demo, have a simple demo MCP server ready

> **Presenter note:** Some log fields and header names can vary by product version. If you do not see the exact field name shown below, look for the equivalent request ID, timing, model, or endpoint metadata.

---

## Step 1: See What VS Code Sends (Local Extension Logs)

### What you do

1. Open **VS Code**.
2. Confirm GitHub Copilot is signed in and enabled.
3. Open the menu **View -> Output**.
4. In the Output panel dropdown, select **GitHub Copilot**.
5. Open **Copilot Chat**.
6. Type this prompt:

```text
What is a SQL injection?
```

7. Submit the prompt.
8. Immediately switch back to the **GitHub Copilot** output channel.
9. Scroll through the newest log entries.
10. Look for items such as:
    - request IDs
    - timestamps or latency values
    - model routing hints
    - chat request lifecycle events

### What you see

You should see fresh log lines appear as soon as the prompt is submitted. Depending on version, the output may include:

- a new request or correlation ID
- timing information
- extension-side processing steps
- model or chat service hints

### What you tell the customer

"This proves the prompt starts in the local Copilot extension. Before anything reaches a model, the extension is the first visible hop. We can see the local request lifecycle begin here."

### Why it matters

This demonstrates that the developer is **not talking directly to a model endpoint from the editor UI**. The extension is the first control point where local context selection and exclusion rules can take effect.

---

## Step 2: Verify Network Destination (CLI Proof)

### What you do

1. Open **PowerShell**.
2. Run:

```powershell
nslookup copilot-proxy.githubusercontent.com
```

3. Point out that the hostname resolves to GitHub-owned infrastructure.
4. Then run:

```powershell
curl -v https://copilot-proxy.githubusercontent.com
```

5. The request will likely return **403 Forbidden** without the right application authentication context. That is fine.
6. In the verbose output, highlight:
    - the TLS handshake
    - the remote host name
    - the certificate chain
7. Point out that the certificate should be issued for `*.githubusercontent.com` by **DigiCert**.

### What you see

- `nslookup` resolves the Copilot proxy hostname
- `curl -v` shows TLS negotiation details
- the server responds from GitHub infrastructure
- the request is rejected without the right auth context, which is expected

### What you tell the customer

"This proves the traffic goes to GitHub’s Copilot proxy endpoint first. Even when we deliberately connect without app authentication, we still see the TLS handshake and certificate for GitHub infrastructure. The developer is not sending prompts directly to OpenAI."

### Why it matters

This is a direct, low-level network proof of the intermediary architecture. It supports the claim that **GitHub is the broker** and the first external destination for the prompt.

---

## Step 3: See the Model Selection (Debug Logs)

### What you do

1. Go back to **VS Code**.
2. Open **View -> Output**.
3. Select **GitHub Copilot Chat** from the dropdown.
4. Submit another simple prompt, for example:

```text
Summarize the difference between authentication and authorization in one paragraph.
```

5. Watch the newest log lines.
6. Look for entries containing:
    - `x-model-version`
    - the model name
    - routing or completion metadata
    - provider hints such as GPT, Claude, or Gemini

### What you see

You may see explicit model metadata, or you may see request/response details that identify which model fulfilled the request. In many builds this appears in headers, request traces, or debug output.

### What you tell the customer

"This is where we show that GitHub chooses and routes to the model. The developer does not connect directly to Anthropic or OpenAI. GitHub remains the intermediary and selects the model behind the scenes."

### Why it matters

This proves model routing is **abstracted behind GitHub’s proxy layer**. That matters for governance, policy enforcement, and provider flexibility.

---

## Step 4: Verify Content Exclusion Works (Live Test)

### What you do

1. In your demo repository, create a folder named `secrets`.
2. Inside it, create a file named `test-secret.txt`.
3. Put this fake value in the file:

```text
API_KEY=fake-key-12345
```

4. In the repository root, open or create `.copilotignore`.
5. Add this line:

```text
secrets/**
```

6. Save the file.
7. If prompted, reload VS Code. If not prompted, run **Developer: Reload Window** from the Command Palette.
8. Open Copilot Chat.
9. Ask:

```text
@workspace What API keys are in the project?
```

10. Show that Copilot does **not** mention `fake-key-12345`.
11. Now remove the `secrets/**` line from `.copilotignore`.
12. Reload the VS Code window again.
13. Ask the same question:

```text
@workspace What API keys are in the project?
```

14. Show that Copilot can now discover or reference the fake key.
15. Re-add the exclusion and delete the test file after the demo.

### What you see

- With `.copilotignore` enabled, Copilot should not reference the excluded file
- Without the exclusion, Copilot may surface the fake key because it is again eligible as workspace context

### What you tell the customer

"This is one of the most important controls. We are proving that content exclusion happens before the file becomes part of prompt context. If we exclude a path, it does not ride along with the prompt."

### Why it matters

This shows a practical preventive control at the **extension/context packaging layer**. It reduces the chance that sensitive files ever enter model context.

---

## Step 5: Prove Response Does Not Persist (Stateless)

### What you do

1. In Copilot Chat, start a new conversation.
2. Type:

```text
Remember the word 'pineapple42'
```

3. Wait for Copilot to acknowledge it.
4. Close that chat session or start a completely new chat thread.
5. In the new session, ask:

```text
What word did I ask you to remember?
```

### What you see

In the new session, Copilot should not know the answer unless the previous context was explicitly carried forward into the same conversation thread.

### What you tell the customer

"This shows the system is session-based, not a long-term personal memory. A fresh session does not automatically remember what happened in a previous one."

### Why it matters

This demonstrates the **stateless nature of prompt handling across sessions**. It helps explain why Copilot is not building a permanent memory of prior chats by default.

---

## Step 6: Network Inspection (Advanced - for Security Teams)

### What you do

1. In VS Code, open **Help -> Toggle Developer Tools**.
2. Go to the **Network** tab.
3. Clear any old network entries.
4. Open Copilot Chat.
5. Submit a simple prompt.
6. In the Network tab, filter for:

```text
copilot
```

7. Click the matching request to `copilot-proxy.githubusercontent.com`.
8. Show:
    - the request URL
    - request headers
    - response headers
9. Highlight any authorization header, model hint, trace ID, or response metadata such as `x-model-version`.

### What you see

You should see a live request from VS Code to the Copilot proxy endpoint, plus the associated request and response metadata.

### What you tell the customer

"For a security team, this is the cleanest proof. We can inspect the actual network call and show exactly where the request goes and what metadata comes back."

### Why it matters

This gives highly credible evidence that the traffic path is transparent and inspectable. It proves the request destination, and often the response metadata confirms which LLM processed it.

---

## Step 7: GitHub Audit Log (Enterprise Only)

### What you do

1. Open a browser and navigate to:

```text
github.com/orgs/{org}/settings/audit-log
```

2. Replace `{org}` with your GitHub organization name.
3. In the audit log search/filter box, enter:

```text
action:copilot
```

4. Review the resulting audit events.
5. Point out the actor, timestamp, and event type.
6. Confirm that the audit log records usage activity, but does **not** expose the actual text of prompts.

### What you see

You should see governance records showing who used Copilot and when, without storing the full prompt content in the audit log view.

### What you tell the customer

"This is governance without surveillance. Security and compliance teams can verify who used Copilot and when, but they are not reading everyone’s prompts in the audit log."

### Why it matters

This demonstrates an important balance: **operational oversight without unnecessary content exposure**.

---

## Step 8: MCP Tool Call Risk Demo

### What you do

1. Prepare a very simple MCP server that exposes a tool returning **fake PII**.
2. For example, the tool could return a fake customer record like:

```json
{
  "name": "Jane Demo",
  "ssn": "000-00-0000",
  "email": "jane.demo@example.com",
  "account": "ACCT-12345"
}
```

3. Configure VS Code/Copilot agent mode to use that MCP server.
4. In Copilot Chat or agent mode, ask the agent to call the tool, for example:

```text
Use the customer lookup tool and summarize the customer record.
```

5. Show that the chat response contains the fake PII values returned by the MCP server.
6. Now update the MCP server so that it **redacts** sensitive fields before returning data, for example:

```json
{
  "name": "Jane Demo",
  "ssn": "***-**-0000",
  "email": "j***.demo@example.com",
  "account": "ACCT-12345"
}
```

7. Restart the MCP server.
8. Run the exact same agent request again.
9. Show that the new chat response now contains only the redacted values.

### What you see

- In the first run, the chat can echo or summarize the raw fake PII because the tool returned it
- In the second run, the model only sees and uses the redacted version because that is all the tool supplied

### What you tell the customer

"This is the critical risk boundary. The model can only work with what our tools hand it. If our MCP server returns raw PII, we are putting raw PII into model context. If we redact before returning, the model never sees the raw value."

### Why it matters

This proves that **your application layer is the real control point for sensitive data**. The safest design is to redact before the tool response ever enters the model prompt.

---

## Suggested presenter wrap-up

Use this summary to close the demo:

> "We have now shown the full prompt journey. The prompt starts in the local extension, travels over TLS to GitHub’s Copilot Proxy, is governed and routed by GitHub, is processed by an approved model provider, and then returns through GitHub policy controls before the answer is shown to the user. We also proved the most important security point: sensitive data risk is determined upstream by what files, tools, and MCP servers are allowed to contribute to prompt context. If we exclude or redact early, we reduce risk before the model ever sees the data."