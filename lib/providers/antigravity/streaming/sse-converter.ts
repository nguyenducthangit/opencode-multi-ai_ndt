import crypto from "node:crypto";
import type { GeminiPart, GeminiSseResponsePayload } from "../types.js";

export interface OpenAiChunkDelta {
  content?: string;
  reasoning_content?: string;
  reasoning?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: "function";
    function: {
      name?: string;
      arguments?: string;
    };
  }>;
}

export interface OpenAiChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: OpenAiChunkDelta;
    finish_reason: "stop" | "tool_calls" | "length" | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export function parseGeminiSseLine(line: string): GeminiSseResponsePayload | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const jsonStr = trimmed.slice(5).trim();
  if (!jsonStr || jsonStr === "[DONE]") return null;

  try {
    return JSON.parse(jsonStr) as GeminiSseResponsePayload;
  } catch {
    return null;
  }
}

export async function* convertGeminiStreamToOpenAi(
  geminiStream: ReadableStream<Uint8Array>,
  model: string,
): AsyncGenerator<OpenAiChatCompletionChunk> {
  const reader = geminiStream.getReader();
  const decoder = new TextDecoder();
  const responseId = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  let buffer = "";
  let toolCallIndex = 0;
  let hasEmittedToolCall = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const payload = parseGeminiSseLine(line);
        if (!payload || !payload.response) continue;

        const candidate = payload.response.candidates?.[0];
        const usage = payload.response.usageMetadata;

        if (candidate?.content?.parts) {
          for (const part of candidate.content.parts) {
            // Check for thought / reasoning - ONLY when part.thought is true
            const isThought = part.thought === true;
            if (isThought) {
              if (part.text) {
                yield {
                  id: responseId,
                  object: "chat.completion.chunk",
                  created,
                  model,
                  choices: [
                    {
                      index: 0,
                      delta: {
                        reasoning_content: part.text,
                        reasoning: part.text,
                      },
                      finish_reason: null,
                    },
                  ],
                };
              }
            } else if (part.text) {
              // Regular text chunk
              yield {
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: { content: part.text },
                    finish_reason: null,
                  },
                ],
              };
            } else if (part.functionCall) {
              // Function call chunk
              hasEmittedToolCall = true;
              const callId = `call_${crypto.randomUUID().slice(0, 8)}`;
              const argsStr = JSON.stringify(part.functionCall.args || {});

              yield {
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: toolCallIndex++,
                          id: callId,
                          type: "function",
                          function: {
                            name: part.functionCall.name,
                            arguments: argsStr,
                          },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              };
            }
          }
        }

        // Check for finishReason or usage
        if (candidate?.finishReason) {
          let finishReason: "stop" | "tool_calls" | "length" = "stop";
          if (candidate.finishReason === "MAX_TOKENS") {
            finishReason = "length";
          } else if (hasEmittedToolCall || candidate.finishReason.toLowerCase().includes("function")) {
            finishReason = "tool_calls";
          }

          yield {
            id: responseId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: finishReason,
              },
            ],
            ...(usage
              ? {
                  usage: {
                    prompt_tokens: usage.promptTokenCount ?? 0,
                    completion_tokens: usage.candidatesTokenCount ?? 0,
                    total_tokens: usage.totalTokenCount ?? 0,
                  },
                }
              : {}),
          };
          return;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
