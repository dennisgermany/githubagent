import type {
  ConversationStep,
  InteractionUpdate,
  SDKMessage,
} from "@cursor/sdk";

export type LogLevel = "error" | "warn" | "info" | "debug";

const LEVEL_RANK: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const THINKING_PREVIEW_CHARS = 2000;
const ASSISTANT_PREVIEW_CHARS = 2000;

function activeLevel(): LogLevel {
  const raw = process.env.AGENT_LOG_LEVEL?.trim().toLowerCase();
  if (raw === "error" || raw === "warn" || raw === "info" || raw === "debug") {
    return raw;
  }
  return "info";
}

function useJsonFormat(): boolean {
  return process.env.AGENT_LOG_FORMAT?.trim().toLowerCase() === "json";
}

function enabled(level: LogLevel): boolean {
  return LEVEL_RANK[level] <= LEVEL_RANK[activeLevel()];
}

function write(level: LogLevel, tag: string, message: string, extra?: object): void {
  if (!enabled(level)) return;

  if (useJsonFormat()) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        tag,
        message,
        ...extra,
      }),
    );
    return;
  }

  const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${tag}]`;
  console.error(`${prefix} ${message}`);
  if (extra && enabled("debug")) {
    console.error(`${prefix} ${JSON.stringify(extra)}`);
  }
}

/** One timestamp; body indented on following lines (avoids per-token log lines). */
function writeBlock(
  level: LogLevel,
  tag: string,
  text: string,
  meta?: string,
): void {
  if (!enabled(level)) return;

  const trimmed = text.trim();
  if (!trimmed) return;

  const label = meta ? `${tag} — ${meta}` : tag;

  if (useJsonFormat()) {
    write(level, tag, trimmed, meta ? { meta } : undefined);
    return;
  }

  const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}]`;
  const header =
    trimmed.length <= 120 && !trimmed.includes("\n")
      ? `${prefix} [${label}] ${trimmed}`
      : `${prefix} [${label}]`;

  console.error(header);
  if (trimmed.length > 120 || trimmed.includes("\n")) {
    for (const line of trimmed.split("\n")) {
      console.error(`${prefix}   ${line}`);
    }
  }
}

export function logError(tag: string, message: string, extra?: object): void {
  write("error", tag, message, extra);
}

export function logWarn(tag: string, message: string, extra?: object): void {
  write("warn", tag, message, extra);
}

export function logInfo(tag: string, message: string, extra?: object): void {
  write("info", tag, message, extra);
}

export function logDebug(tag: string, message: string, extra?: object): void {
  write("debug", tag, message, extra);
}

function preview(text: string, max = THINKING_PREVIEW_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}… (${trimmed.length} chars total)`;
}

function mergeStreamChunk(buffer: string, chunk: string): string {
  if (!chunk) return buffer;
  if (!buffer) return chunk;
  if (chunk.startsWith(buffer)) return chunk;
  if (buffer.startsWith(chunk)) return buffer;
  if (buffer.endsWith(chunk) || buffer.includes(chunk)) return buffer;
  return buffer + chunk;
}

class StreamLogAggregator {
  private assistantBuffer = "";
  private thinkingBuffer = "";
  private lastAssistantLogged = "";
  private lastThinkingLogged = "";

  appendAssistant(chunk: string): void {
    this.assistantBuffer = mergeStreamChunk(this.assistantBuffer, chunk);
    if (enabled("debug")) {
      logDebug("assistant-delta", chunk);
    }
  }

  appendThinking(chunk: string): void {
    this.thinkingBuffer = mergeStreamChunk(this.thinkingBuffer, chunk);
    if (enabled("debug")) {
      logDebug("thinking-delta", chunk);
    }
  }

  flushAssistant(reason: string): void {
    const text = this.assistantBuffer.trim();
    this.assistantBuffer = "";
    if (!text || text === this.lastAssistantLogged) return;
    this.lastAssistantLogged = text;
    writeBlock("info", "assistant", preview(text, ASSISTANT_PREVIEW_CHARS), reason);
  }

  flushThinking(reason: string): void {
    const text = this.thinkingBuffer.trim();
    this.thinkingBuffer = "";
    if (!text || text === this.lastThinkingLogged) return;
    this.lastThinkingLogged = text;
    writeBlock("info", "thinking", preview(text), reason);
  }

  hasLoggedAssistant(text: string): boolean {
    return text.trim() === this.lastAssistantLogged;
  }

  reset(): void {
    this.assistantBuffer = "";
    this.thinkingBuffer = "";
    this.lastAssistantLogged = "";
    this.lastThinkingLogged = "";
  }
}

let streamAggregator = new StreamLogAggregator();

export function resetStreamLogs(): void {
  streamAggregator.reset();
}

export function flushStreamLogs(reason = "end"): void {
  streamAggregator.flushAssistant(reason);
  streamAggregator.flushThinking(reason);
}

function summarizeToolArgs(
  toolType: string,
  args: Record<string, unknown>,
): string {
  switch (toolType) {
    case "shell":
      return String(args.command ?? "");
    case "write":
    case "delete":
      return String(args.path ?? "");
    case "read":
      return String(args.path ?? args.target ?? "");
    case "glob":
      return String(args.globPattern ?? "");
    default:
      return JSON.stringify(args).slice(0, 200);
  }
}

export function logConversationStep(step: ConversationStep): void {
  switch (step.type) {
    case "assistantMessage": {
      const text = step.message.text.trim();
      if (!text) return;
      streamAggregator.flushAssistant("step");
      streamAggregator.flushThinking("step");
      if (!streamAggregator.hasLoggedAssistant(text)) {
        writeBlock(
          "info",
          "step",
          preview(text, ASSISTANT_PREVIEW_CHARS),
          `${text.length} chars`,
        );
      }
      break;
    }
    case "toolCall": {
      streamAggregator.flushAssistant("step");
      streamAggregator.flushThinking("step");
      const tool = step.message;
      const summary = summarizeToolArgs(
        tool.type,
        tool.args as Record<string, unknown>,
      );
      const status = tool.result?.status ?? "pending";
      logInfo("step", `Tool ${tool.type} [${status}] ${summary}`);
      if (enabled("debug") && tool.result?.status === "success" && tool.type === "shell") {
        const value = tool.result.value as {
          exitCode?: number;
          stdout?: string;
          stderr?: string;
        };
        logDebug("step", "Shell output", {
          exitCode: value.exitCode,
          stdout: value.stdout?.slice(0, 500),
          stderr: value.stderr?.slice(0, 500),
        });
      }
      break;
    }
    default:
      logDebug("step", `Unhandled step type: ${(step as { type: string }).type}`, {
        step,
      });
  }
}

export function logInteractionDelta(update: InteractionUpdate): void {
  const kind = (update as { type?: string }).type;
  const deltaText =
    (update as { text?: string }).text ?? (update as { delta?: string }).delta ?? "";

  switch (kind) {
    case "thinking-delta":
    case "thinkingDelta":
      if (deltaText) streamAggregator.appendThinking(deltaText);
      break;
    case "thinking-completed":
    case "thinkingCompleted":
      streamAggregator.flushThinking("completed");
      logInfo("thinking", "Thinking completed", {
        durationMs: (update as { thinkingDurationMs?: number }).thinkingDurationMs,
      });
      break;
    case "text-delta":
    case "textDelta":
      if (deltaText) streamAggregator.appendAssistant(deltaText);
      break;
    case "tool-call-started":
    case "toolCallStarted":
      streamAggregator.flushAssistant("tool_started");
      streamAggregator.flushThinking("tool_started");
      logInfo("delta", "Tool call started", {
        name: (update as { toolName?: string; name?: string }).toolName
          ?? (update as { name?: string }).name,
      });
      break;
    case "tool-call-completed":
    case "toolCallCompleted":
      logInfo("delta", "Tool call completed");
      break;
    case "turn-ended":
    case "turnEnded":
      streamAggregator.flushAssistant("turn_ended");
      streamAggregator.flushThinking("turn_ended");
      logInfo("delta", "Turn ended");
      break;
    default:
      logDebug("delta", kind ? `Update: ${kind}` : "Interaction update", { update });
  }
}

export function logStreamMessage(message: SDKMessage): void {
  switch (message.type) {
    case "system":
      logInfo("stream", "System init", {
        runId: message.run_id,
        model: message.model?.id,
        tools: message.tools?.length,
      });
      break;
    case "status":
      streamAggregator.flushAssistant("status");
      streamAggregator.flushThinking("status");
      logInfo("stream", `Status ${message.status}`, {
        runId: message.run_id,
        detail: message.message,
      });
      break;
    case "thinking": {
      streamAggregator.flushAssistant("thinking");
      if (message.text.trim()) {
        streamAggregator.appendThinking(message.text);
      }
      streamAggregator.flushThinking("message");
      if (enabled("debug") && message.text.length > THINKING_PREVIEW_CHARS) {
        logDebug("thinking", message.text);
      }
      break;
    }
    case "assistant": {
      for (const block of message.message.content) {
        if (block.type === "text" && block.text) {
          streamAggregator.appendAssistant(block.text);
        } else if (block.type === "tool_use") {
          streamAggregator.flushAssistant("tool_use");
          logInfo("assistant", `Planning tool: ${block.name}`, {
            id: block.id,
            input: enabled("debug") ? block.input : undefined,
          });
        }
      }
      break;
    }
    case "tool_call":
      streamAggregator.flushAssistant("tool_call");
      streamAggregator.flushThinking("tool_call");
      logInfo(
        "tool",
        `${message.name} [${message.status}]`,
        enabled("debug")
          ? { callId: message.call_id, args: message.args, result: message.result }
          : { callId: message.call_id },
      );
      break;
    case "task":
      if (message.text?.trim() || message.status) {
        logInfo("task", message.text ?? message.status ?? "task update");
      }
      break;
    case "user":
      logDebug("stream", "User message event");
      break;
    case "request":
      logDebug("stream", `Request ${message.request_id}`);
      break;
    default:
      logDebug("stream", "Unknown message", { message });
  }
}
