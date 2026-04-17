import express, { Request, Response } from 'express';
import {
  handleScan,
  handleCVEs,
  handleJira,
  handleGovernance,
  handleSBOM,
  handleZeroDay,
  handleTrends,
  handleRemediate,
  HandlerResult,
} from './handlers';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.COPILOT_EXT_PORT || '3001', 10);

interface CopilotMessage {
  role: string;
  content: string;
}

interface CopilotRequest {
  messages: CopilotMessage[];
}

// Parse slash command and arguments from the last user message
function parseCommand(content: string): { command: string; args: Record<string, string> } {
  const trimmed = content.trim();

  // Match /command pattern
  const slashMatch = trimmed.match(/^\/(\w+)\s*(.*)/s);
  if (slashMatch) {
    return { command: slashMatch[1].toLowerCase(), args: parseArgs(slashMatch[2]) };
  }

  // Fallback: keyword detection
  const lower = trimmed.toLowerCase();
  if (lower.includes('scan')) { return { command: 'scan', args: {} }; }
  if (lower.includes('cve')) { return { command: 'cves', args: {} }; }
  if (lower.includes('jira')) { return { command: 'jira', args: parseArgs(trimmed) }; }
  if (lower.includes('governance')) { return { command: 'governance', args: {} }; }
  if (lower.includes('sbom')) { return { command: 'sbom', args: {} }; }
  if (lower.includes('zero') && lower.includes('day')) { return { command: 'zeroday', args: {} }; }
  if (lower.includes('trend')) { return { command: 'trends', args: {} }; }
  if (lower.includes('remediat')) { return { command: 'remediate', args: {} }; }

  return { command: 'help', args: {} };
}

function parseArgs(raw: string): Record<string, string> {
  const args: Record<string, string> = {};
  // Simple key:value or key=value parsing
  const pairs = raw.match(/(\w+)[=:]("[^"]+"|'[^']+'|\S+)/g);
  if (pairs) {
    for (const pair of pairs) {
      const [key, ...rest] = pair.split(/[=:]/);
      args[key] = rest.join(':').replace(/^["']|["']$/g, '');
    }
  }
  // If no structured args, store raw text as query
  if (Object.keys(args).length === 0 && raw.trim()) {
    args.query = raw.trim();
  }
  return args;
}

function sendSSE(res: Response, data: string): void {
  // Copilot Extensions use SSE format
  const lines = data.split('\n');
  for (const line of lines) {
    const event = JSON.stringify({
      choices: [{ delta: { content: line + '\n' }, index: 0 }],
    });
    res.write(`data: ${event}\n\n`);
  }
  res.write('data: [DONE]\n\n');
}

function helpMessage(): string {
  return `### @ghas-security — Available Commands

| Command | Description |
|---------|-------------|
| \`/scan\` | Scan repo for vulnerabilities affecting your dependencies |
| \`/cves\` | Show latest CVEs from the feed |
| \`/jira\` | List or search Jira tickets |
| \`/jira create summary="..." priority="High"\` | Create a Jira ticket |
| \`/governance\` | Run governance summary check |
| \`/sbom\` | Generate Software Bill of Materials |
| \`/zeroday\` | Show active zero-day threat alerts |
| \`/trends\` | Show vulnerability trend summary |
| \`/remediate\` | Start remediation pipeline (coming soon) |

You can also just describe what you need in natural language!`;
}

// Main Copilot chat handler
app.post('/', async (req: Request, res: Response) => {
  try {
    const body = req.body as CopilotRequest;
    const messages = body.messages || [];
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');

    if (!lastUserMessage) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      sendSSE(res, helpMessage());
      return res.end();
    }

    const { command, args } = parseCommand(lastUserMessage.content);
    let result: HandlerResult;

    switch (command) {
      case 'scan':
        result = await handleScan();
        break;
      case 'cves':
        result = await handleCVEs(lastUserMessage.content);
        break;
      case 'jira':
        result = await handleJira(args);
        break;
      case 'governance':
        result = await handleGovernance();
        break;
      case 'sbom':
        result = await handleSBOM();
        break;
      case 'zeroday':
        result = await handleZeroDay();
        break;
      case 'trends':
        result = await handleTrends();
        break;
      case 'remediate':
        result = await handleRemediate(args);
        break;
      default:
        result = { body: helpMessage() };
        break;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    sendSSE(res, result.body);
    res.end();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    sendSSE(res, `### ❌ Internal Error\n\n\`\`\`\n${message}\n\`\`\``);
    res.end();
  }
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: '@ghas/copilot-extension' });
});

app.listen(PORT, () => {
  console.log(`@ghas-security Copilot Extension listening on port ${PORT}`);
});
