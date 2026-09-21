import crypto from "node:crypto";
import type {
  GeminiContent,
  GeminiGenerationConfig,
  GeminiInternalPayload,
  GeminiPart,
  GeminiTool,
} from "../types.js";
import { cleanJSONSchemaForAntigravity, sanitizeFunctionName } from "./clean-schema.js";
import { ANTIGRAVITY_DEFAULT_MODELS, DEFAULT_THINKING_AG_SIGNATURE } from "../constants.js";

export interface OpenAiToolCall {
  id?: string;
  type?: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAiToolCall[];
}

export interface OpenAiTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface OpenAiRequestBody {
  model?: string;
  messages?: OpenAiMessage[];
  tools?: OpenAiTool[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  sessionId?: string;
  [key: string]: unknown;
}

function extractText(content: OpenAiMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export function resolveInternalModel(modelName?: string): {
  internalModel: string;
  thinkingBudget?: number;
} {
  const raw = (modelName || "gemini-3-flash").replace(/^(antigravity\/|ag\/)/, "").toLowerCase();

  // Instant / zero thinking models (FASTEST)
  if (
    raw === "gemini-3-flash" ||
    raw === "gemini-flash" ||
    raw === "gemini-3-flash-zero" ||
    raw === "gemini-3-flash-command"
  ) {
    return { internalModel: "gemini-3-flash", thinkingBudget: 0 };
  }

  // Extra low thinking
  if (raw.includes("extra-low")) {
    return { internalModel: "gemini-3.5-flash-extra-low", thinkingBudget: 1024 };
  }

  // Low / Medium thinking
  if (raw.includes("low")) {
    if (raw.includes("pro")) {
      return { internalModel: "gemini-3.1-pro-low", thinkingBudget: 4096 };
    }
    return { internalModel: "gemini-3.6-flash-low", thinkingBudget: 2048 };
  }

  // Gemini Pro models
  if (raw.includes("pro") || raw === "gemini-3.1-pro" || raw === "gemini-2.5-pro") {
    return { internalModel: "gemini-pro-agent", thinkingBudget: 16384 };
  }

  // Claude models supported by Antigravity Cloud Code
  if (raw.includes("claude-sonnet") || raw === "claude-3-7-sonnet-thought") {
    return { internalModel: "claude-sonnet-4-6" };
  }
  if (raw.includes("claude-opus")) {
    return { internalModel: "claude-opus-4-6-thinking" };
  }

  // High thinking / Agent (gemini-3.8-flash, gemini-3.8-flash-high, gemini-3.6-flash-high, gemini-3.7-flash, gemini-flash)
  if (
    raw.includes("high") ||
    raw.includes("agent") ||
    raw.includes("flash") ||
    raw.includes("3.8") ||
    raw.includes("3.7") ||
    raw.includes("3.6")
  ) {
    return { internalModel: "gemini-3.6-flash-high", thinkingBudget: 16384 };
  }

  return { internalModel: "gemini-3-flash", thinkingBudget: 0 };
}

export function transformOpenAiToGemini(
  body: OpenAiRequestBody,
  options: {
    projectId: string;
    sessionId?: string;
  },
): GeminiInternalPayload {
  const rawModel = body.model || "gemini-3-flash";
  const { internalModel, thinkingBudget } = resolveInternalModel(rawModel);
  const mappedModelName = internalModel;

  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const contents: GeminiContent[] = [];

  // Extract system prompt if present
  let systemText = "";
  const filteredMessages: OpenAiMessage[] = [];
  for (const msg of rawMessages) {
    if (msg.role === "system") {
      const txt = extractText(msg.content);
      if (txt) {
        systemText = systemText ? `${systemText}\n\n${txt}` : txt;
      }
    } else {
      filteredMessages.push(msg);
    }
  }

  const toolCallIdToName = new Map<string, string>();

  for (let i = 0; i < filteredMessages.length; i++) {
    const msg = filteredMessages[i];
    const parts: GeminiPart[] = [];

    // Prepend system prompt to the first user message
    if (contents.length === 0 && msg.role === "user" && systemText) {
      parts.push({ text: `System Instructions:\n${systemText}\n\nUser Request:\n` });
    }

    if (msg.role === "user") {
      const txt = extractText(msg.content);
      if (txt) parts.push({ text: txt });
      if (parts.length === 0) parts.push({ text: " " });
      contents.push({ role: "user", parts });
    } else if (msg.role === "assistant") {
      const txt = extractText(msg.content);
      if (txt) parts.push({ text: txt });

      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          if (tc.id && tc.function?.name) {
            toolCallIdToName.set(tc.id, tc.function.name);
          }
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            args = { raw: tc.function.arguments };
          }
          parts.push({
            thoughtSignature: DEFAULT_THINKING_AG_SIGNATURE,
            thought_signature: DEFAULT_THINKING_AG_SIGNATURE,
            functionCall: {
              name: sanitizeFunctionName(tc.function.name),
              args,
            },
          });
        }
      }
      if (parts.length === 0) parts.push({ text: " " });
      contents.push({ role: "model", parts });
    } else if (msg.role === "tool") {
      const txt = extractText(msg.content);
      let responseObj: Record<string, unknown>;
      try {
        responseObj = JSON.parse(txt);
        if (typeof responseObj !== "object" || responseObj === null || Array.isArray(responseObj)) {
          responseObj = { result: txt };
        }
      } catch {
        responseObj = { result: txt };
      }

      const fnName =
        msg.name ||
        (msg.tool_call_id ? toolCallIdToName.get(msg.tool_call_id) : undefined) ||
        "tool";

      parts.push({
        functionResponse: {
          name: sanitizeFunctionName(fnName),
          response: responseObj,
        },
      });
      // Tool responses in Gemini have role "user"
      contents.push({ role: "user", parts });
    }
  }

  // Merge consecutive same-role contents
  const mergedContents: GeminiContent[] = [];
  for (const c of contents) {
    const prev = mergedContents[mergedContents.length - 1];
    if (prev && prev.role === c.role) {
      prev.parts.push(...c.parts);
    } else {
      mergedContents.push({ role: c.role, parts: [...c.parts] });
    }
  }

  // Transform tools
  let geminiTools: GeminiTool[] | undefined;
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    const declarations = body.tools.map((t) => ({
      name: sanitizeFunctionName(t.function.name),
      description: t.function.description || "",
      parameters: cleanJSONSchemaForAntigravity(t.function.parameters || {}),
    }));
    geminiTools = [{ functionDeclarations: declarations }];
  }

  const generationConfig: GeminiGenerationConfig = {
    maxOutputTokens: 16384,
  };
  if (typeof body.temperature === "number") {
    generationConfig.temperature = body.temperature;
  }
  if (thinkingBudget !== undefined) {
    if (thinkingBudget === 0) {
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    } else {
      generationConfig.thinkingConfig = {
        includeThoughts: true,
        thinkingBudget,
      };
    }
  }

  const sessionId = options.sessionId || body.sessionId || crypto.randomUUID();

  return {
    project: options.projectId,
    model: mappedModelName,
    userAgent: "antigravity",
    requestType: "agent",
    requestId: `agent-${crypto.randomUUID()}`,
    request: {
      contents: mergedContents,
      ...(geminiTools ? { tools: geminiTools } : {}),
      generationConfig,
      sessionId,
      ...(geminiTools && geminiTools.length > 0
        ? { toolConfig: { functionCallingConfig: { mode: "VALIDATED" } } }
        : {}),
    },
  };
}
