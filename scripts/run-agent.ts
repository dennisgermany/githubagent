import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Agent, CursorAgentError, type AgentOptions, type Run } from "@cursor/sdk";
import {
  logConversationStep,
  logDebug,
  logError,
  logInfo,
  logInteractionDelta,
  logStreamMessage,
  logWarn,
} from "./agent-logger.js";

const apiKey = process.env.CURSOR_API_KEY;
if (!apiKey) {
  console.error("CURSOR_API_KEY is required");
  process.exit(1);
}

const defaultPromptPath = join(
  process.cwd(),
  "prompts",
  "update-giro-2026.md",
);

function loadPrompt(): string {
  const fromEnv = process.env.AGENT_PROMPT?.trim();
  if (fromEnv) return fromEnv;

  try {
    return readFileSync(defaultPromptPath, "utf8").trim();
  } catch {
    console.error(`Failed to read default prompt at ${defaultPromptPath}`);
    process.exit(1);
  }
}

const prompt = loadPrompt();

function buildAgentOptions(): AgentOptions {
  return {
    apiKey,
    model: { id: "composer-2.5" },
    local: {
      cwd: process.cwd(),
      settingSources: ["project"],
    },
  };
}

async function consumeStream(run: Run): Promise<void> {
  if (!run.supports("stream")) {
    logWarn(
      "stream",
      run.unsupportedReason("stream") ?? "Stream not supported for this run",
    );
    return;
  }

  for await (const message of run.stream()) {
    logStreamMessage(message);
  }
}

logInfo("agent", "Using local runtime");
logInfo("agent", `Prompt source: ${process.env.AGENT_PROMPT?.trim() ? "AGENT_PROMPT" : defaultPromptPath}`);
logDebug("agent", `Prompt length: ${prompt.length} characters`);

try {
  await using agent = await Agent.create(buildAgentOptions());
  logInfo("agent", `Agent created: ${agent.agentId}`);

  const run = await agent.send(prompt, {
    onStep: ({ step }) => {
      logConversationStep(step);
    },
    onDelta: ({ update }) => {
      logInteractionDelta(update);
    },
  });

  logInfo("run", `Run started: ${run.id}`);

  const [result] = await Promise.all([run.wait(), consumeStream(run)]);

  logInfo("run", `Run finished: ${result.id}`, {
    status: result.status,
    durationMs: result.durationMs,
  });

  if (result.result) {
    console.log("\n--- Agent response ---\n");
    console.log(result.result);
  }

  if (result.status === "error") {
    logError("run", "Agent run ended with error status");
    process.exit(2);
  }
} catch (err) {
  if (err instanceof CursorAgentError) {
    logError("agent", `Startup failed: ${err.message}`, {
      retryable: err.isRetryable,
    });
    if (err.message.includes("Storage mode is disabled")) {
      console.error(`
Your account may block API agent usage. Try enabling regular Privacy Mode
(not Legacy/Ghost) in Cursor → Settings → Privacy, then re-run.

Docs: https://cursor.com/docs/sdk/typescript
`);
    }
    process.exit(1);
  }
  throw err;
}
