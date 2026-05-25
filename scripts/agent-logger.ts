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

const THINKING_PREVIEW_CHARS = 2000;

function preview(text: string, max = THINKING_PREVIEW_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}… (${trimmed.length} chars total)`;
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
    case "assistantMessage":
      logInfo(
        "step",
        `Assistant (${step.message.text.length} chars)`,
        enabled("debug") ? { text: step.message.text } : undefined,
      );
      break;
    case "toolCall": {
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
  switch (kind) {
    case "thinking-delta":
    case "thinkingDelta": {
      const text = (update as { text?: string; delta?: string }).text
        ?? (update as { delta?: string }).delta
        ?? "";
      if (text) logInfo("thinking-delta", text);
      break;
    }
    case "thinking-completed":
    case "thinkingCompleted":
      logInfo("thinking", "Thinking completed", {
        durationMs: (update as { thinkingDurationMs?: number }).thinkingDurationMs,
      });
      break;
    case "text-delta":
    case "textDelta": {
      const text = (update as { text?: string; delta?: string }).text
        ?? (update as { delta?: string }).delta;
      if (text && enabled("debug")) logDebug("text-delta", text);
      break;
    }
    case "tool-call-started":
    case "toolCallStarted":
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
      logInfo("stream", `Status ${message.status}`, {
        runId: message.run_id,
        detail: message.message,
      });
      break;
    case "thinking": {
      const duration =
        message.thinking_duration_ms != null
          ? ` (${message.thinking_duration_ms}ms)`
          : "";
      logInfo("thinking", `Thinking${duration}: ${preview(message.text)}`);
      if (enabled("debug") && message.text.length > THINKING_PREVIEW_CHARS) {
        logDebug("thinking", message.text);
      }
      break;
    }
    case "assistant": {
      for (const block of message.message.content) {
        if (block.type === "text" && block.text.trim()) {
          logInfo("assistant", preview(block.text, 500));
        } else if (block.type === "tool_use") {
          logInfo("assistant", `Planning tool: ${block.name}`, {
            id: block.id,
            input: enabled("debug") ? block.input : undefined,
          });
        }
      }
      break;
    }
    case "tool_call":
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
