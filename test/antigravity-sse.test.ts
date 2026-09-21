import { describe, expect, it } from "vitest";
import {
  convertGeminiStreamToOpenAi,
  parseGeminiSseLine,
  type OpenAiChatCompletionChunk,
} from "../lib/providers/antigravity/streaming/sse-converter.js";

function createReadableStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + "\n"));
      }
      controller.close();
    },
  });
}

describe("Antigravity SSE Stream Converter", () => {
  it("parses data lines correctly", () => {
    expect(parseGeminiSseLine("")).toBeNull();
    expect(parseGeminiSseLine(": keep-alive")).toBeNull();
    expect(parseGeminiSseLine("data: [DONE]")).toBeNull();

    const line = 'data: {"response":{"candidates":[{"content":{"parts":[{"text":"hello"}]},"index":0}]}}';
    const parsed = parseGeminiSseLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed?.response?.candidates?.[0]?.content?.parts?.[0]?.text).toBe("hello");
  });

  it("converts text parts to OpenAI content chunks", async () => {
    const rawEvents = [
      'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Hello "}]}}]}}',
      'data: {"response":{"candidates":[{"content":{"parts":[{"text":"world!"}]}}]}}',
      'data: {"response":{"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5,"totalTokenCount":15}}}',
    ];

    const stream = createReadableStream(rawEvents);
    const generator = convertGeminiStreamToOpenAi(stream, "gemini-3.8-flash");

    const chunks: OpenAiChatCompletionChunk[] = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0].choices[0].delta.content).toBe("Hello ");
    expect(chunks[0].choices[0].finish_reason).toBeNull();

    expect(chunks[1].choices[0].delta.content).toBe("world!");
    expect(chunks[1].choices[0].finish_reason).toBeNull();

    expect(chunks[2].choices[0].finish_reason).toBe("stop");
    expect(chunks[2].usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
  });

  it("converts thought parts to reasoning_content chunks", async () => {
    const rawEvents = [
      'data: {"response":{"candidates":[{"content":{"parts":[{"thought":true,"text":"Thinking about solution..."}]}}]}}',
      'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Here is the code."}]}}]}}',
      'data: {"response":{"candidates":[{"finishReason":"STOP"}]}}',
    ];

    const stream = createReadableStream(rawEvents);
    const generator = convertGeminiStreamToOpenAi(stream, "gemini-3.8-flash");

    const chunks: OpenAiChatCompletionChunk[] = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0].choices[0].delta.reasoning_content).toBe("Thinking about solution...");
    expect(chunks[1].choices[0].delta.content).toBe("Here is the code.");
    expect(chunks[2].choices[0].finish_reason).toBe("stop");
  });

  it("converts functionCall parts to tool_calls chunks", async () => {
    const rawEvents = [
      'data: {"response":{"candidates":[{"content":{"parts":[{"functionCall":{"name":"write_to_file","args":{"TargetFile":"main.dart","CodeContent":"void main() {}"}}}]}}]}}',
      'data: {"response":{"candidates":[{"finishReason":"STOP"}]}}',
    ];

    const stream = createReadableStream(rawEvents);
    const generator = convertGeminiStreamToOpenAi(stream, "gemini-3.8-flash");

    const chunks: OpenAiChatCompletionChunk[] = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    const toolCall = chunks[0].choices[0].delta.tool_calls?.[0];
    expect(toolCall).toBeDefined();
    expect(toolCall?.function.name).toBe("write_to_file");
    expect(JSON.parse(toolCall?.function.arguments || "{}")).toEqual({
      TargetFile: "main.dart",
      CodeContent: "void main() {}",
    });
    // finish_reason should reflect tool_calls
    expect(chunks[1].choices[0].finish_reason).toBe("tool_calls");
  });
});
