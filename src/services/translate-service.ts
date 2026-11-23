import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/api-response";
import { config } from "@/lib/config";
import { proposalSchema, type ActionProposal } from "@/lib/ai-tools";
import { completeJson } from "@/lib/ollama";
import {
  LANGUAGE_CODES, MAX_TRANSLATE_CHARS, assemble, languageName, segment, translationNote, type LanguageCode,
} from "@/lib/translate";
import { translateMessages } from "@/lib/translate-prompts";
import { getNote } from "@/repositories/note-repository";
import { assertNotLocked } from "@/services/note-lock-service";

/*
 * Translate a note into a new one (ROADMAP 57). Code takes maths, code, links and addresses out and puts them back (`lib/translate.ts`); an engine
 * translates the lines between. Engines: a self-hosted LibreTranslate when `TRANSLATE_URL` is set, else (or when it is unreachable) the local model.
 * The result is a `note` proposal the person reads and confirms through the audited path; the original is never touched.
 */

/** Translates plain strings, one answer per string in the same order. */
export type Engine = (lines: string[], target: LanguageCode) => Promise<string[]>;

const CONTEXT_TOKENS = 8_192;
const BATCH_CHARS = 1_500;
const BATCH_LINES = 20;
const LINES_SCHEMA = { type: "object", properties: { lines: { type: "array", items: { type: "string" } } }, required: ["lines"] };
const LINES = z.object({ lines: z.array(z.string()) });

export const modelEngine: Engine = async (lines, target) => {
  const answer = LINES.safeParse(await completeJson(translateMessages(lines, target), LINES_SCHEMA, CONTEXT_TOKENS));
  if (!answer.success) throw new AppError("AI_OUTPUT_INVALID", "The model did not return the translated lines.");
  return answer.data.lines;
};

/** A self-hosted LibreTranslate at an address the owner set in the environment: never an address from the browser. */
export function libreEngine(baseUrl: string): Engine {
  return async (lines, target) => {
    let response: Response;
    try {
      response = await fetch(new URL("/translate", baseUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: lines, source: "auto", target, format: "text" }),
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw new AppError("INTEGRATION_ERROR", "The translation service is unreachable.", error);
    }
    if (!response.ok) throw new AppError("INTEGRATION_ERROR", `The translation service answered ${response.status}.`);
    const body = z.object({ translatedText: z.array(z.string()) }).safeParse(await response.json().catch(() => null));
    if (!body.success) throw new AppError("INTEGRATION_ERROR", "The translation service gave an answer this app cannot read.");
    return body.data.translatedText;
  };
}

const unreachable = (error: unknown) => error instanceof AppError && (error.code === "AI_UNAVAILABLE" || error.code === "INTEGRATION_ERROR");

/** Tries each engine in order; a later one only when an earlier one is unreachable (any other failure is a real one and stops). */
export function chain(engines: Engine[]): Engine {
  return async (lines, target) => {
    let last: unknown;
    for (const engine of engines) {
      try {
        return await engine(lines, target);
      } catch (error) {
        if (!unreachable(error)) throw error;
        last = error;
      }
    }
    throw last;
  };
}

/** The configured engines in order of preference: the self-hosted service when set, then the local model. */
export const defaultEngine = (): Engine => chain([...(config.TRANSLATE_URL ? [libreEngine(config.TRANSLATE_URL)] : []), modelEngine]);

function batches<T extends { body: string }>(items: T[]): number[][] {
  const out: number[][] = [];
  let current: number[] = [];
  let size = 0;
  for (const [index, item] of items.entries()) {
    if (current.length > 0 && (size + item.body.length > BATCH_CHARS || current.length >= BATCH_LINES)) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(index);
    size += item.body.length;
  }
  if (current.length > 0) out.push(current);
  return out;
}

export type TranslationResult = { proposal: ActionProposal; translated: number; kept: number };

export async function translateNote(
  userId: string,
  noteId: string,
  language: string,
  deps: { engine?: Engine; now?: Date; onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<TranslationResult> {
  const target = z.enum(LANGUAGE_CODES).safeParse(language);
  if (!target.success) throw new AppError("VALIDATION_ERROR", "Choose a language from the list.");
  const note = z.uuid().safeParse(noteId).success ? await getNote(userId, noteId) : null;
  if (!note) throw new AppError("RESOURCE_NOT_FOUND", "That note does not exist.");
  // A locked note's text is ciphertext: translating it would send noise to an engine (and, unlocked, the text to a service).
  assertNotLocked(note);
  if (note.content.length > MAX_TRANSLATE_CHARS) {
    throw new AppError("VALIDATION_ERROR", `This note is longer than ${MAX_TRANSLATE_CHARS.toLocaleString("en-US")} characters, which is more than can be translated in one go here. Translate part of it.`);
  }
  const segments = segment(note.content);
  const lines = segments.flatMap((s) => (s.kind === "text" ? [s] : []));
  if (lines.length === 0) throw new AppError("VALIDATION_ERROR", "There is no text in this note to translate.");

  const engine = deps.engine ?? defaultEngine();
  const answers: (string | null)[] = new Array(lines.length).fill(null);
  const groups = batches(lines);
  for (const [done, group] of groups.entries()) {
    // The person left: stop calling an engine for a translation nobody will see.
    if (deps.signal?.aborted) throw new AppError("VALIDATION_ERROR", "The translation was stopped.");
    const bodies = group.map((i) => lines[i].body);
    let out = await engine(bodies, target.data);
    if (out.length !== bodies.length) {
      // The engine merged or split lines: ask again one line at a time rather than guess which is which.
      out = [];
      for (const body of bodies) {
        const single = await engine([body], target.data);
        out.push(single.length === 1 ? single[0] : "");
      }
    }
    group.forEach((lineIndex, k) => {
      answers[lineIndex] = out[k] ?? null;
    });
    deps.onProgress?.(done + 1, groups.length);
  }

  const result = assemble(segments, answers);
  if (result.translated === 0) {
    throw new AppError("AI_OUTPUT_INVALID", `No line could be translated into ${languageName(target.data)} safely. Nothing was made.`);
  }
  const built = translationNote(note.title, target.data, result.text, result, deps.now ?? new Date());
  const proposal = proposalSchema.parse({ kind: "note", title: built.title, content: built.content });
  return { proposal, translated: result.translated, kept: result.kept };
}
