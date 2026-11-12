import "server-only";
import { Ollama } from "ollama";
import type { AbortableAsyncIterator, ChatResponse } from "ollama";
import { config, EMBEDDING_DIMENSIONS } from "@/lib/config";
import { AppError } from "@/lib/api-response";

const globalForOllama = globalThis as unknown as {
  ollama: Ollama | undefined;
};

export const ollama =
  globalForOllama.ollama ?? new Ollama({ host: config.OLLAMA_BASE_URL });

if (process.env.NODE_ENV !== "production") {
  globalForOllama.ollama = ollama;
}

export type EmbeddingTask = "query" | "document";

// nomic-embed-text is trained with asymmetric task prefixes; omitting them
// measurably degrades retrieval because queries and documents then land in
// slightly different regions of the space. Models that do not use this
// convention must receive the text unchanged.
function applyTaskPrefix(text: string, task: EmbeddingTask): string {
  if (!config.OLLAMA_EMBEDDING_MODEL.startsWith("nomic-embed-text")) {
    return text;
  }
  return task === "query" ? `search_query: ${text}` : `search_document: ${text}`;
}

export async function embedTexts(
  texts: string[],
  task: EmbeddingTask,
): Promise<number[][]> {
  if (texts.length === 0) return [];

  let embeddings: number[][];
  try {
    const response = await ollama.embed({
      model: config.OLLAMA_EMBEDDING_MODEL,
      input: texts.map((text) => applyTaskPrefix(text, task)),
    });
    embeddings = response.embeddings;
  } catch (error) {
    throw new AppError(
      "AI_UNAVAILABLE",
      `Embedding model "${config.OLLAMA_EMBEDDING_MODEL}" is unreachable. Is "ollama serve" running?`,
      error,
    );
  }

  if (embeddings.length !== texts.length) {
    throw new AppError(
      "AI_UNAVAILABLE",
      `Embedding model returned ${embeddings.length} vectors for ${texts.length} inputs.`,
    );
  }

  for (const embedding of embeddings) {
    assertValidEmbedding(embedding);
  }

  return embeddings;
}

export async function embedDocuments(texts: string[]): Promise<number[][]> {
  return embedTexts(texts, "document");
}

export async function embedQuery(text: string): Promise<number[]> {
  const [embedding] = await embedTexts([text], "query");
  return embedding;
}

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ToolCall = { name: string; arguments: Record<string, unknown> };

export async function callWithTools(
  messages: ChatMessage[],
  tools: readonly unknown[],
): Promise<ToolCall[]> {
  try {
    const response = await ollama.chat({
      model: config.OLLAMA_CHAT_MODEL,
      messages,
      tools: tools as Parameters<typeof ollama.chat>[0]["tools"],
      stream: false,
      options: { temperature: 0 },
    });

    return (response.message.tool_calls ?? [])
      .filter((call) => call.function?.name)
      .map((call) => ({
        name: call.function.name,
        arguments: (call.function.arguments ?? {}) as Record<string, unknown>,
      }));
  } catch (error) {
    throw new AppError(
      "AI_UNAVAILABLE",
      `Chat model "${config.OLLAMA_CHAT_MODEL}" is unreachable. Is "ollama serve" running?`,
      error,
    );
  }
}

export type ChatChunk =
  | { type: "text"; text: string }
  | { type: "tool"; call: ToolCall };

export async function* streamChat(
  messages: ChatMessage[],
  signal?: AbortSignal,
  tools?: readonly unknown[],
): AsyncGenerator<ChatChunk> {
  let stream: AbortableAsyncIterator<ChatResponse>;
  try {
    stream = await ollama.chat({
      model: config.OLLAMA_CHAT_MODEL,
      messages,
      stream: true,
      options: { temperature: 0.2 },
      ...(tools && tools.length > 0
        ? { tools: tools as Parameters<typeof ollama.chat>[0]["tools"] }
        : {}),
    });
  } catch (error) {
    throw new AppError(
      "AI_UNAVAILABLE",
      `Chat model "${config.OLLAMA_CHAT_MODEL}" is unreachable. Is "ollama serve" running?`,
      error,
    );
  }

  try {
    for await (const part of stream) {
      if (signal?.aborted) break;

      if (part.message?.content) {
        yield { type: "text", text: part.message.content };
      }

      // Tool calls arrive alongside the text stream rather than replacing it, so
      // a single request covers both answering and proposing.
      for (const call of part.message?.tool_calls ?? []) {
        if (!call.function?.name) continue;
        yield {
          type: "tool",
          call: {
            name: call.function.name,
            arguments: (call.function.arguments ?? {}) as Record<string, unknown>,
          },
        };
      }
    }
  } finally {
    if (signal?.aborted) stream.abort();
  }
}

/**
 * Single-shot completion constrained by a JSON schema. Ollama enforces the shape
 * at decode time, but the result is still untrusted: it can satisfy the schema
 * and be nonsense, so callers must validate semantics with Zod afterwards.
 */
export async function completeJson(
  messages: ChatMessage[],
  schema: object,
  /** The context window in tokens. Ollama's default is small, and text past it is dropped silently. */
  contextTokens?: number,
): Promise<unknown> {
  let raw: string;
  try {
    const response = await ollama.chat({
      model: config.OLLAMA_CHAT_MODEL,
      messages,
      format: schema,
      stream: false,
      options: contextTokens ? { temperature: 0, num_ctx: contextTokens } : { temperature: 0 },
    });
    raw = response.message.content;
  } catch (error) {
    throw new AppError(
      "AI_UNAVAILABLE",
      `Chat model "${config.OLLAMA_CHAT_MODEL}" is unreachable. Is "ollama serve" running?`,
      error,
    );
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError(
      "AI_OUTPUT_INVALID",
      "The model did not return valid JSON.",
    );
  }
}

export function assertValidEmbedding(
  embedding: number[],
): asserts embedding is number[] {
  if (
    embedding.length !== EMBEDDING_DIMENSIONS ||
    embedding.some((value) => !Number.isFinite(value))
  ) {
    throw new AppError(
      "AI_OUTPUT_INVALID",
      `Invalid embedding: expected ${EMBEDDING_DIMENSIONS} finite dimensions, got ${embedding.length}.`,
    );
  }
}
