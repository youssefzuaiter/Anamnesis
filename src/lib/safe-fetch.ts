// Fetching a URL a person gave us, from the server, without letting that URL reach anything only the
// server can reach (SSRF). Used by the web clipper and by calendar subscriptions.
//
// What makes it safe, and why each part is needed:
// - only http(s), no user name or password in the link;
// - names without a dot and local suffixes (localhost, .local, .internal, .lan, .home.arpa) are refused
//   outright: in Docker, `ntfy`, `postgres` and `host.docker.internal` are exactly the things to protect;
// - every address a name resolves to is checked at connect time, inside the connection's own DNS lookup,
//   so a public-looking name that points inside (or changes its answer between a check and the request)
//   is refused; an IP written in the link is checked before any request;
// - redirects are followed by hand, at most three, each hop checked like the first;
// - the body is counted while it streams, after decompression, so a huge or compressed-bomb page stops
//   at the cap; one deadline covers the whole fetch, redirects included.

import { lookup as dnsLookup } from "node:dns/promises";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";
import { AppError } from "@/lib/api-response";

// One list per family: a BlockList holding the IPv4-mapped IPv6 range below would also match every
// plain IPv4 address checked against it.
const BLOCKED_V4 = new BlockList();
const BLOCKED_V6 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) {
  BLOCKED_V4.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
  // IPv4 written inside IPv6 (mapped, NAT64, 6to4): blocked whole, there is no legitimate need here.
  ["::ffff:0:0", 96], ["64:ff9b::", 96], ["2002::", 16],
] as const) {
  BLOCKED_V6.addSubnet(network, prefix, "ipv6");
}

/** True for any address this server must not be made to connect to, and for anything that is not an address. */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return BLOCKED_V4.check(ip, "ipv4");
  if (family === 6) return BLOCKED_V6.check(ip, "ipv6");
  return true;
}

const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".localdomain"];
const UNREACHABLE = "That address is not reachable from this server.";

/** The host of a URL as an address, without IPv6 brackets; null when it is a name. */
function literalAddress(url: URL): string | null {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return isIP(host) ? host : null;
}

/** Why a URL may not be fetched, or null if it may. `allowAddress` lets a test reach its own loopback server. */
function refusal(url: URL, allowAddress?: (ip: string) => boolean): string | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Use an http(s) link.";
  if (url.username || url.password) return "Links with a user name or password are not fetched.";
  const address = literalAddress(url);
  if (address) return allowAddress?.(address) || !isBlockedAddress(address) ? null : UNREACHABLE;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) return UNREACHABLE;
  return null;
}

/**
 * Parses a link a person typed and refuses what this server must not fetch. `schemes` may add `webcal:`,
 * which is read as https (what calendar apps hand out).
 */
export function assertPublicUrl(raw: string, schemes: string[] = ["http:", "https:"]): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new AppError("VALIDATION_ERROR", "That is not a valid link.");
  }
  if (!schemes.includes(url.protocol)) throw new AppError("VALIDATION_ERROR", "Use an http(s) link.");
  if (url.protocol === "webcal:") url = new URL(`https:${url.href.slice("webcal:".length)}`);
  const why = refusal(url);
  if (why) throw new AppError("VALIDATION_ERROR", why);
  return url;
}

type Kind = "blocked" | "timeout" | "too-large" | "status" | "unreachable" | "type" | "redirects";

const MESSAGES: Record<Kind, [AppError["code"], string]> = {
  blocked: ["VALIDATION_ERROR", UNREACHABLE],
  timeout: ["INTEGRATION_ERROR", "That page took too long to answer."],
  "too-large": ["VALIDATION_ERROR", "That page is too large."],
  status: ["INTEGRATION_ERROR", "The page could not be fetched."],
  unreachable: ["INTEGRATION_ERROR", "Could not reach that address."],
  type: ["VALIDATION_ERROR", "That link does not lead to a web page."],
  redirects: ["INTEGRATION_ERROR", "That link redirects too many times."],
};

/** A refused or failed fetch. `kind` says which, so a caller can word it for its own feature. */
export class SafeFetchError extends AppError {
  constructor(
    readonly kind: Kind,
    message?: string,
    readonly status?: number,
  ) {
    super(MESSAGES[kind][0], message ?? MESSAGES[kind][1]);
    this.name = "SafeFetchError";
  }
}

export type Resolve = (host: string) => Promise<{ address: string; family: number }[]>;

const systemResolve: Resolve = (host) => dnsLookup(host, { all: true, verbatim: true });

const BLOCKED_MARK = Symbol("blocked");

/** The connection's own DNS lookup: every answer must be allowed, or the connection is not made. */
function guardedLookup(resolve: Resolve, allowAddress?: (ip: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (answers) => {
        if (answers.length === 0) return callback(Object.assign(new Error("no address"), { code: "ENOTFOUND" }), "", 4);
        if (answers.some((answer) => !allowAddress?.(answer.address) && isBlockedAddress(answer.address))) {
          return callback(Object.assign(new Error(UNREACHABLE), { [BLOCKED_MARK]: true }), "", 4);
        }
        if ((options as { all?: boolean }).all) {
          (callback as unknown as (error: null, addresses: { address: string; family: number }[]) => void)(null, answers);
        } else {
          callback(null, answers[0].address, answers[0].family);
        }
      },
      (error) => callback(error as NodeJS.ErrnoException, "", 4),
    );
  };
}

function request(url: URL, headers: Record<string, string>, lookup: LookupFunction, signal: AbortSignal): Promise<IncomingMessage> {
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(url, { method: "GET", headers, lookup, signal, agent: false }, resolve);
    req.on("error", reject);
    req.end();
  });
}

function decoded(response: IncomingMessage): Readable {
  const encoding = String(response.headers["content-encoding"] ?? "").toLowerCase().trim();
  if (encoding === "gzip" || encoding === "x-gzip") return response.pipe(createGunzip());
  if (encoding === "deflate") return response.pipe(createInflate());
  if (encoding === "br") return response.pipe(createBrotliDecompress());
  return response;
}

function decodeText(bytes: Buffer, contentType: string): string {
  const label = /charset=["']?([^;"'\s]+)/i.exec(contentType)?.[1];
  if (label) {
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // An unknown charset reads as UTF-8 rather than failing the whole page.
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

export async function safeFetchText(
  start: URL,
  options: {
    maxBytes: number;
    timeoutMs: number;
    accept: string;
    allow: (contentType: string) => boolean;
    maxRedirects?: number;
    resolve?: Resolve;
    allowAddress?: (ip: string) => boolean;
  },
): Promise<{ text: string; finalUrl: URL; contentType: string }> {
  const deadline = AbortSignal.timeout(options.timeoutMs);
  const lookup = guardedLookup(options.resolve ?? systemResolve, options.allowAddress);
  const headers = {
    Accept: options.accept,
    "Accept-Encoding": "gzip, deflate, br",
    "User-Agent": "Anamnesis (self-hosted notes; fetches one page when asked)",
  };

  let url = start;
  for (let hop = 0; ; hop++) {
    const why = refusal(url, options.allowAddress);
    if (why) throw new SafeFetchError("blocked", why);

    let response: IncomingMessage;
    try {
      response = await request(url, headers, lookup, deadline);
    } catch (error) {
      if (deadline.aborted) throw new SafeFetchError("timeout");
      if ((error as Record<symbol, unknown>)[BLOCKED_MARK]) throw new SafeFetchError("blocked");
      throw new SafeFetchError("unreachable");
    }

    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400 && response.headers.location) {
      response.resume();
      if (hop >= (options.maxRedirects ?? 3)) throw new SafeFetchError("redirects");
      try {
        url = new URL(response.headers.location, url);
      } catch {
        throw new SafeFetchError("unreachable");
      }
      continue;
    }
    if (status < 200 || status >= 300) {
      response.resume();
      throw new SafeFetchError("status", `The page answered ${status}.`, status);
    }

    const contentType = String(response.headers["content-type"] ?? "");
    if (!options.allow(contentType.toLowerCase())) {
      response.destroy();
      throw new SafeFetchError("type");
    }

    const chunks: Buffer[] = [];
    let size = 0;
    const body = decoded(response);
    try {
      for await (const chunk of body) {
        size += (chunk as Buffer).length;
        if (size > options.maxBytes) {
          response.destroy();
          body.destroy();
          throw new SafeFetchError("too-large");
        }
        chunks.push(chunk as Buffer);
      }
    } catch (error) {
      if (error instanceof SafeFetchError) throw error;
      if (deadline.aborted) throw new SafeFetchError("timeout");
      throw new SafeFetchError("unreachable");
    }
    return { text: decodeText(Buffer.concat(chunks), contentType), finalUrl: url, contentType };
  }
}
