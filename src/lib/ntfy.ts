// Publishing to the self-hosted ntfy server. One HTTP request per notification, nothing else: no
// dependency, no retries here (the scheduler retries, and records why a send failed).
//
// The message goes as JSON to the server's root rather than as headers on the topic's URL: JSON carries
// Turkish and every other non-ASCII title exactly, and a title can never become a header of its own.

export type PushMessage = { topic: string; title: string; body: string; tags?: string[] };

export type Publish = (message: PushMessage) => Promise<void>;

/**
 * Why a request got no answer, in words that are safe to store and show: "timed out", a system error
 * code such as ECONNREFUSED, or "network error". Never the address, the token or a stack.
 */
function noAnswerReason(error: unknown): string {
  const failure = error as { name?: string; cause?: { code?: unknown } } | null;
  if (failure?.name === "TimeoutError" || failure?.name === "AbortError") return "timed out";
  const code = failure?.cause?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{2,40}$/.test(code) ? code : "network error";
}

/**
 * A publisher for the ntfy server at `baseUrl`, authenticated with `token`. A failure is an Error whose
 * message is safe to show and store: the HTTP status, or "did not answer" and why, never the token or the
 * reply.
 */
export function ntfyPublisher(baseUrl: string, token: string, timeoutMs = 10_000): Publish {
  const url = `${baseUrl.replace(/\/+$/, "")}/`;

  return async (message) => {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: message.topic,
          title: message.title,
          message: message.body,
          tags: message.tags ?? [],
          priority: 3,
        }),
        signal: AbortSignal.timeout(timeoutMs),
        // A redirect would carry the request somewhere else; ntfy never sends one.
        redirect: "error",
      });
    } catch (error) {
      throw new Error(`ntfy did not answer (${noAnswerReason(error)})`);
    }
    // The reply is not needed; reading it frees the connection.
    await response.text().catch(() => "");
    if (!response.ok) throw new Error(`ntfy answered ${response.status}`);
  };
}
