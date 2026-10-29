import "server-only";
import { AppError } from "@/lib/api-response";
import { MIN_MENTION_TITLE_LENGTH, mentionSnippet } from "@/lib/mentions";
import { appendSeeAlso, canLinkTitle, linksTo, MAX_NOTE_LENGTH } from "@/lib/see-also";
import { findSimilarEntities } from "@/lib/vector";
import { MAX_LINKS, normalizeTitle, parseWikiLinks } from "@/lib/wiki-links";
import * as linkRepository from "@/repositories/link-repository";
import * as noteRepository from "@/repositories/note-repository";
import * as noteService from "@/services/note-service";

/**
 * Measured, not guessed (CLAUDE.md, "Link suggestions"): under nomic-embed-text,
 * notes in one field scored 0.60 to 0.81 and notes in different fields 0.47 to 0.71.
 * They overlap, so the floor favours precision. Re-measure if the embedding model
 * changes.
 */
export const SUGGESTION_MIN_SIMILARITY = 0.7;
export const MAX_SUGGESTIONS = 5;
export const MAX_MENTIONS = 5;

const SIMILAR_CANDIDATES = 20;
const MAX_NAMED_CANDIDATES = 100;
const MENTION_CANDIDATES = 50;

export type LinkReason = "similar" | "named";

export type LinkSuggestion = {
  id: string;
  title: string;
  /** Why it is offered; "named" always comes first. */
  reasons: LinkReason[];
  /** Best chunk-to-chunk similarity, or null when it is offered only by name. */
  similarity: number | null;
  /** Where the title is written in the text, for a "named" reason. */
  snippet: string | null;
};

type TitledNote = { id: string; title: string };

/** Titles that two or more live notes share once case and spacing are folded. */
function sharedTitles(notes: TitledNote[]): Set<string> {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const note of notes) {
    const key = normalizeTitle(note.title);
    if (seen.has(key)) shared.add(key);
    seen.add(key);
  }
  return shared;
}

/**
 * The ids among `notes` that a `[[title]]` written for them would really open.
 * Asked of the same resolver the index uses, because it compares titles exactly
 * (only case is folded): a title with a trailing space does not resolve from the
 * trimmed text between the brackets, and a link that resolves nowhere is silent.
 */
async function openableIds(userId: string, notes: TitledNote[]): Promise<Set<string>> {
  if (notes.length === 0) return new Set();
  const { resolved } = await linkRepository.resolveNoteTitles(
    userId,
    notes.map((note) => note.title.trim()),
  );
  const byTitle = new Map(resolved.map((note) => [normalizeTitle(note.title), note.id]));
  return new Set(
    notes
      .filter((note) => byTitle.get(normalizeTitle(note.title)) === note.id)
      .map((note) => note.id),
  );
}

async function similarNotes(
  userId: string,
  noteId: string,
): Promise<{ id: string; similarity: number }[]> {
  try {
    const hits = await findSimilarEntities(userId, "note", noteId, SIMILAR_CANDIDATES, ["note"]);
    return hits
      .map((hit) => ({ id: hit.sourceId, similarity: Number(hit.similarity) }))
      .filter((hit) => hit.similarity >= SUGGESTION_MIN_SIMILARITY);
  } catch (error) {
    // Suggestions by name still work without the vectors.
    console.error("[WARN] Similar-note lookup unavailable:", error);
    return [];
  }
}

/**
 * Notes this one could link to: close in meaning (from the stored vectors, no model
 * call) or named in its text. Never a note it already links to, a deleted one, one
 * whose title cannot be written as a link or is shared with another note, or one the
 * written link would not open. Nothing is written.
 */
export async function suggestLinks(userId: string, noteId: string): Promise<LinkSuggestion[]> {
  const note = await noteRepository.getNote(userId, noteId);
  if (!note) return [];

  const [all, outgoing, similar] = await Promise.all([
    noteRepository.listNoteTitles(userId),
    linkRepository.getOutgoingLinks(userId, noteId),
    similarNotes(userId, noteId),
  ]);
  const shared = sharedTitles(all);
  const linked = new Set(outgoing.map((target) => target.id));
  const isOffered = (other: TitledNote) =>
    other.id !== noteId &&
    !linked.has(other.id) &&
    canLinkTitle(other.title) &&
    !shared.has(normalizeTitle(other.title)) &&
    !linksTo(note.content, other.title);

  const found = new Map<string, { title: string; snippet: string | null; similarity: number | null }>();

  const text = note.content.toLowerCase();
  for (const other of all) {
    if (found.size >= MAX_NAMED_CANDIDATES) break;
    const title = other.title.trim();
    if (title.length < MIN_MENTION_TITLE_LENGTH || !isOffered(other)) continue;
    // Cheap test before the exact one: the title's longest word must be in the text at all.
    const longest = title.split(/\s+/).reduce((a, b) => (b.length > a.length ? b : a));
    if (!text.includes(longest.toLowerCase())) continue;
    const snippet = mentionSnippet(note.content, title);
    if (snippet !== null) found.set(other.id, { title: other.title, snippet, similarity: null });
  }

  const byId = new Map(all.map((other) => [other.id, other]));
  for (const hit of similar) {
    const other = byId.get(hit.id);
    if (!other || !isOffered(other)) continue;
    const existing = found.get(other.id);
    found.set(other.id, {
      title: other.title,
      snippet: existing?.snippet ?? null,
      similarity: hit.similarity,
    });
  }

  const ranked = [...found.entries()]
    .map(([id, entry]) => ({ id, ...entry }))
    .sort(
      (a, b) =>
        Number(b.snippet !== null) - Number(a.snippet !== null) ||
        (b.similarity ?? -1) - (a.similarity ?? -1) ||
        a.title.localeCompare(b.title),
    );

  const openable = await openableIds(userId, ranked);
  return ranked
    .filter((entry) => openable.has(entry.id))
    .slice(0, MAX_SUGGESTIONS)
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      reasons: [
        ...(entry.snippet !== null ? (["named"] as const) : []),
        ...(entry.similarity !== null ? (["similar"] as const) : []),
      ],
      similarity: entry.similarity,
      snippet: entry.snippet,
    }));
}

/**
 * Other notes that write this note's title as plain words without linking to it.
 * Empty when the title could not be linked to safely (too short, brackets, shared
 * with another note, or a link to it would open nothing). Nothing is written.
 */
export async function findMentionsOf(userId: string, noteId: string): Promise<LinkSuggestion[]> {
  const note = await noteRepository.getNote(userId, noteId);
  if (!note) return [];

  const title = note.title.trim();
  if (!canLinkTitle(title) || title.length < MIN_MENTION_TITLE_LENGTH) return [];

  const [all, backlinks] = await Promise.all([
    noteRepository.listNoteTitles(userId),
    linkRepository.getBacklinks(userId, noteId),
  ]);
  if (sharedTitles(all).has(normalizeTitle(title))) return [];
  if (!(await openableIds(userId, [note])).has(note.id)) return [];

  const rows = await noteRepository.listNotesContaining(
    userId,
    title,
    [noteId, ...backlinks.map((backlink) => backlink.id)],
    MENTION_CANDIDATES,
  );

  const mentions: LinkSuggestion[] = [];
  for (const row of rows) {
    if (linksTo(row.content, title)) continue;
    const snippet = mentionSnippet(row.content, title);
    if (snippet === null) continue;
    mentions.push({ id: row.id, title: row.title, reasons: ["named"], similarity: null, snippet });
    if (mentions.length === MAX_MENTIONS) break;
  }
  return mentions;
}

/**
 * Adds `[[To title]]` to the From note as a bullet under "See also", through the
 * same save as every other edit: a version of the old text is kept (History undoes
 * it), the note is re-indexed and its links resynced. Both notes must be the
 * caller's own live notes. Refuses a title the link could not open the target by.
 */
export async function addLink(
  userId: string,
  fromId: string,
  toId: string,
): Promise<{ added: boolean; fromTitle: string; toTitle: string }> {
  if (fromId === toId) {
    throw new AppError("VALIDATION_ERROR", "A note cannot link to itself.");
  }

  const [from, to] = await Promise.all([
    noteRepository.getNote(userId, fromId),
    noteRepository.getNote(userId, toId),
  ]);
  if (!from || !to) {
    throw new AppError("RESOURCE_NOT_FOUND", "That note no longer exists.");
  }
  const result = { fromTitle: from.title, toTitle: to.title };

  if (linksTo(from.content, to.title)) return { added: false, ...result };

  if (!canLinkTitle(to.title)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "That title can't be written as a link: it has brackets.",
    );
  }
  const all = await noteRepository.listNoteTitles(userId);
  if (sharedTitles(all).has(normalizeTitle(to.title))) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Another note has the same title, so a link would open that one instead. Rename one of them first.",
    );
  }
  if (!(await openableIds(userId, [to])).has(to.id)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "A link to that note would not open it. Check its title for extra spaces.",
    );
  }
  if (parseWikiLinks(from.content).length >= MAX_LINKS) {
    throw new AppError(
      "VALIDATION_ERROR",
      `That note already has ${MAX_LINKS} links, the most the app follows.`,
    );
  }

  const { content } = appendSeeAlso(from.content, to.title);
  if (content.length > MAX_NOTE_LENGTH) {
    throw new AppError("VALIDATION_ERROR", "That note is too long to add another link.");
  }

  await noteService.updateNote(userId, fromId, {
    title: from.title,
    content,
    tags: from.tags,
    isFavorite: from.isFavorite,
    projectId: from.projectId,
    courseId: from.courseId,
  });
  return { added: true, ...result };
}
