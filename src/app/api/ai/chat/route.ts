import { z } from "zod";
import { requireUserId } from "@/lib/session";
import { toApiResponse } from "@/lib/api-response";
import { assistantScopeSchema } from "@/lib/assistant-scope";
import { assertScopeOwned } from "@/services/scope-service";
import { answerQuestion } from "@/services/assistant-service";
import {
  createConversation,
  appendMessage,
  titleFrom,
} from "@/repositories/conversation-repository";

const chatSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(10_000),
      }),
    )
    .max(20)
    .default([]),
  // Absent on the first turn of a thread; the server creates one and says so
  // in the opening frame.
  conversationId: z.uuid().nullish(),
  // Limits the search to one course, project or note; null or absent is
  // everything. It is client input, so it is checked against the caller's own
  // data below, before a thread is opened.
  scope: assistantScopeSchema.nullish(),
});

export async function POST(request: Request) {
  let userId: string;
  let parsed: z.infer<typeof chatSchema>;

  try {
    userId = await requireUserId();
    const result = chatSchema.safeParse(await request.json());
    if (!result.success) {
      const badScope = result.error.issues.some((issue) => issue.path[0] === "scope");
      return Response.json(
        {
          success: false,
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: badScope
              ? "Choose a course, a project or a note to ask about."
              : "Ask a question between 1 and 2000 characters.",
          },
        },
        { status: 400 },
      );
    }
    parsed = result.data;

    // Refused here, as a plain 404, so no thread is opened and nothing streams
    // for a scope that is not the caller's own.
    if (parsed.scope) await assertScopeOwned(userId, parsed.scope);
  } catch (error) {
    const body = toApiResponse(error);
    const code = body.error?.code;
    const status = code === "AUTH_REQUIRED" ? 401 : code === "RESOURCE_NOT_FOUND" ? 404 : 500;
    return Response.json(body, { status });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));

      // Persisted so a thread survives a reload. The answer is accumulated as
      // it streams and written once at the end — a partial answer is still
      // worth keeping, since the user saw it.
      let conversationId = parsed.conversationId ?? null;
      let answer = "";
      let citations: unknown = null;

      try {
        if (!conversationId) {
          const conversation = await createConversation(
            userId,
            titleFrom(parsed.question),
          );
          conversationId = conversation.id;
          send({
            type: "conversation",
            id: conversation.id,
            title: conversation.title,
          });
        }
        await appendMessage(userId, conversationId, {
          role: "user",
          content: parsed.question,
        });

        for await (const event of answerQuestion(
          userId,
          parsed.question,
          parsed.history,
          request.signal,
          parsed.scope ?? null,
        )) {
          if (event.type === "delta") answer += event.text;
          if (event.type === "citations") citations = event.citations;
          send(event);
        }
      } catch (error) {
        const body = toApiResponse(error);
        send({ type: "error", error: body.error });
      } finally {
        if (conversationId && answer) {
          await appendMessage(userId, conversationId, {
            role: "assistant",
            content: answer,
            citations,
          }).catch(() => {});
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
