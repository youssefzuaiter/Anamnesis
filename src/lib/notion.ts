// Reading a Notion "Markdown & CSV" export (ROADMAP item 37). Pure: no Prisma, no filesystem, no network. The zip is hostile
// data, so nothing in it is an id, an owner or a path that is used: a name is only matched against the other names in the
// same zip, links are rewritten from the ids in those names, and every scan is bounded and linear.
//
// What Notion writes: a page is `Page title <32 hex>.md`, a page's sub-pages and files sit in a folder `Page title <32 hex>/`,
// a database is `Database <32 hex>.csv` (or `…_all.csv`) with each row's page in the folder of the same name, and a link to
// another page is a relative, URL-encoded Markdown link to that page's file.

import { scanFences } from "@/lib/markdown-fences";
import { canLinkTitle } from "@/lib/see-also";
import { cleanTitle } from "@/lib/vault-import";

const HEX32 = /([0-9a-f]{32})$/i;
/** A page's own title line and the first lines of its body are all that is looked at for a title. */
const TITLE_SCAN_LINES = 20;

export type DatabaseChoice = "project" | "course" | "none";
export const DATABASE_CHOICES: readonly DatabaseChoice[] = ["project", "course", "none"];

/** A file name without its extension, as the title it shows and the 32-character id Notion appended. */
export function splitNotionName(stem: string): { title: string; id: string | null } {
  const trimmed = stem.trim();
  const match = / ?([0-9a-f]{32})$/i.exec(trimmed);
  if (!match) return { title: trimmed, id: null };
  return { title: trimmed.slice(0, trimmed.length - match[0].length).trim(), id: match[1].toLowerCase() };
}

const dirOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
const fileOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const stemOf = (file: string) => (file.lastIndexOf(".") > 0 ? file.slice(0, file.lastIndexOf(".")) : file);
const extOf = (file: string) => (file.lastIndexOf(".") > 0 ? file.slice(file.lastIndexOf(".") + 1).toLowerCase() : "");

export type NotionLayout = {
  /** Markdown pages, by path. */
  pages: { path: string; id: string | null; title: string; database: string | null }[];
  /** Databases found, by their id: the name and how many row pages each holds. */
  databases: { id: string; name: string; rows: number }[];
  /** Every other file, by path: what a page can attach. */
  files: string[];
  /** What the zip looks like, when it is not a Markdown export. */
  problem: "html" | "nested" | "none" | null;
};

/**
 * Which entries are pages, which pages are rows of a database, and which are files. Paths use `/` and have no wrapper folder
 * (the caller strips one). A database is a `.csv` named like a folder, and a page sitting directly in that folder is a row.
 */
export function analyseLayout(paths: readonly string[]): NotionLayout {
  const pagePaths: string[] = [];
  const files: string[] = [];
  const csvFolders = new Map<string, { id: string; name: string }>();
  let html = 0;
  let zips = 0;
  for (const path of paths) {
    const file = fileOf(path);
    const ext = extOf(file);
    if (ext === "md") pagePaths.push(path);
    else if (ext === "csv") {
      const stem = stemOf(path).replace(/_all$/i, "");
      const { title, id } = splitNotionName(fileOf(stem));
      if (id !== null) csvFolders.set(stem, { id, name: title });
    } else if (ext === "html" || ext === "htm") html += 1;
    else if (ext === "zip") {
      zips += 1;
      files.push(path);
    } else files.push(path);
  }

  const rows = new Map<string, number>();
  const pages = pagePaths.map((path) => {
    const { title, id } = splitNotionName(stemOf(fileOf(path)));
    const dir = dirOf(path);
    const database = csvFolders.has(dir) ? csvFolders.get(dir)!.id : null;
    if (database !== null) rows.set(database, (rows.get(database) ?? 0) + 1);
    return { path, id, title, database };
  });
  const databases = [...csvFolders.values()]
    .filter((db, index, all) => all.findIndex((other) => other.id === db.id) === index)
    .map((db) => ({ id: db.id, name: db.name, rows: rows.get(db.id) ?? 0 }))
    .filter((db) => db.rows > 0);

  let problem: NotionLayout["problem"] = null;
  if (pages.length === 0) problem = zips > 0 ? "nested" : html > 0 ? "html" : "none";
  return { pages, databases, files, problem };
}

/** The sentence for a zip that is not a usable Markdown export. */
export const LAYOUT_PROBLEM: Record<NonNullable<NotionLayout["problem"]>, string> = {
  html: "This looks like Notion's HTML export. Export again with Format set to “Markdown & CSV”.",
  nested:
    "This zip holds another zip (Notion does that for large exports). Unzip it and choose the inner “Export-…” zip, or export again in smaller parts.",
  none: "There are no Markdown pages in this zip. Export from Notion with Format set to “Markdown & CSV”.",
};

// --- one page ---------------------------------------------------------------------------------------

/**
 * A relative link target as a path inside the zip, from the folder the page is in. Percent-encoding is undone, `.` and `..`
 * are resolved, and a path that climbs out of the zip is no path at all (null). Never used to reach a file.
 */
export function resolveTarget(pageDir: string, target: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(target.trim());
  } catch {
    return null;
  }
  decoded = decoded.replaceAll("\\", "/").replace(/[?#][\s\S]*$/, "");
  if (decoded === "" || decoded.startsWith("/") || /\p{Cc}/u.test(decoded)) return null;
  const out = pageDir === "" ? [] : pageDir.split("/");
  for (const part of decoded.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join("/");
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** The page id at the end of a notion.so address (`…/Title-0123…32hex`). */
function notionAddressId(target: string): string | null {
  if (!/^https?:\/\/(?:[\w-]+\.)?notion\.(?:so|site)\//i.test(target)) return null;
  const path = target.replace(/[?#][\s\S]*$/, "").replace(/\/$/, "");
  const match = HEX32.exec(path);
  return match ? match[1].toLowerCase() : null;
}

export type PageContext = {
  /** The page being converted. */
  path: string;
  /** The title of a page of this export, by path or by id, or null when no such page. */
  titleByPath(path: string): string | null;
  titleById(id: string): string | null;
  /** Whether a path in the zip is a file a note may attach, and its canonical path. */
  fileAt(path: string): string | null;
};

export type ConvertedPage = {
  title: string;
  content: string;
  /** Files of the zip this page uses, by path, in order, each once. */
  attachments: string[];
  linksConverted: number;
  linksUnresolved: number;
};

/**
 * One page's text as a note. The first `# Heading` is the title (else the file's name) and leaves the body. Links to other pages
 * of the export become `[[Title]]` (original titles, so a second import finds the same text and adds nothing); a link to a page
 * that is not in the export, or a title that cannot be written as a link, keeps its words. A file the page shows or links to
 * is attached to the note and its line says so. Outside code only, in one linear pass with bounded patterns.
 */
export function convertPage(raw: string, fallbackTitle: string, context: PageContext): ConvertedPage {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const { inFence } = scanFences(lines);

  let title = fallbackTitle;
  let start = 0;
  for (let i = 0; i < Math.min(lines.length, TITLE_SCAN_LINES); i++) {
    if (lines[i].trim() === "") continue;
    const heading = /^#{1} +(.+?) *#*$/.exec(lines[i]);
    if (heading) {
      title = heading[1];
      start = i + 1;
      while (start < lines.length && lines[start].trim() === "") start += 1;
    }
    break;
  }

  const attachments: string[] = [];
  let linksConverted = 0;
  let linksUnresolved = 0;
  const pageDir = dirOf(context.path);

  const convertLine = (line: string): string =>
    line
      .split(/(`+[^`\n]*`+)/)
      .map((piece, at) =>
        at % 2 === 1
          ? piece
          : piece.replace(/(!?)\[([^\]\n]{0,300})\]\(([^)\n]{1,1000})\)/g, (whole, bang: string, text: string, target: string) => {
              const trimmed = target.trim();
              const external = SCHEME.test(trimmed);
              const notionId = external ? notionAddressId(trimmed) : null;
              // An ordinary web or mail address stays a link. Any other scheme (javascript:, data:, file:) is not carried into a note.
              if (external && notionId === null) {
                if (/^(?:https?|mailto):/i.test(trimmed)) return whole;
                linksUnresolved += 1;
                return text;
              }
              const path = external ? null : resolveTarget(pageDir, trimmed);
              // A relative or absolute path that is not inside the zip (a climb, `/etc/passwd`, a bad escape) is not a link in a note.
              if (!external && path === null) {
                linksUnresolved += 1;
                return text;
              }

              // A page of this export.
              const isPage = (path !== null && extOf(path) === "md") || notionId !== null;
              if (isPage) {
                let pageTitle: string | null = null;
                if (path !== null) {
                  const fileId = splitNotionName(stemOf(fileOf(path))).id;
                  pageTitle = context.titleByPath(path) ?? (fileId === null ? null : context.titleById(fileId));
                }
                if (pageTitle === null && notionId !== null) pageTitle = context.titleById(notionId);
                if (pageTitle !== null && bang === "" && canLinkTitle(pageTitle)) {
                  linksConverted += 1;
                  return `[[${pageTitle.trim()}]]`;
                }
                linksUnresolved += 1;
                return text;
              }

              // A file of this export.
              if (path !== null) {
                const file = context.fileAt(path);
                if (file !== null) {
                  if (!attachments.includes(file)) attachments.push(file);
                  const name = fileOf(file);
                  return `(attached: ${name.replace(/[()\[\]]/g, " ")})`;
                }
                // A link to something that is not in the zip (another database's CSV, a deleted file): its words stay.
                linksUnresolved += 1;
                return text;
              }
              return text;
            }),
      )
      .join("");

  const body = lines.slice(start).map((line, index) => (inFence[start + index] ? line : convertLine(line)));
  return {
    title: cleanTitle(title) || cleanTitle(fallbackTitle) || "Untitled",
    content: body.join("\n").replace(/\s+$/, ""),
    attachments,
    linksConverted,
    linksUnresolved,
  };
}

/** The code a project or course made from a database gets: at most 20 characters, as a course code is. */
export function databaseCode(name: string): string {
  return cleanTitle(name).slice(0, 20).trim() || "Notion";
}
