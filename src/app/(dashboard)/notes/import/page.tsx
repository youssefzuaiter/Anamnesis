import Link from "next/link";
import { PdfImportForm } from "@/components/pdf-import-form";
import { MarkdownImportForm } from "@/components/markdown-import-form";
import { VaultImportForm } from "@/components/vault-import-form";
import { ClipForm } from "@/components/clip-form";

export const metadata = { title: "Import · Anamnesis" };

export default function ImportPdfPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-5">
        <Link
          href="/notes"
          className="text-sm text-text-muted transition-colors hover:text-text"
        >
          ← Notes
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-text">
          Import notes
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Extracts the text and saves it as a regular note — searchable,
          citable by the assistant, and taggable like anything else. Works
          best on text-based PDFs; a scanned photo of a page has no text to
          extract.
        </p>
      </header>

      <h2 className="mb-2 text-xs font-semibold text-text-faint">
        From a PDF
      </h2>
      <PdfImportForm />

      <h2 className="mb-2 mt-6 text-xs font-semibold text-text-faint">
        Clip a web page
      </h2>
      <p className="mb-2 text-sm text-text-muted">
        Paste a link and the readable article becomes a note, with a line at
        the top saying where it came from. Menus, adverts and scripts are left
        behind. Only public pages are fetched (nothing on this machine or its
        network), up to 5 MB and 15 seconds; a page behind a sign-in has no
        article to clip.
      </p>
      <ClipForm />

      <h2 className="mb-2 mt-6 text-xs font-semibold text-text-faint">
        From Markdown files
      </h2>
      <p className="mb-2 text-sm text-text-muted">
        Select any number of .md files — from Obsidian, a wiki export, or
        anywhere else. Each becomes its own note, titled by its first heading if
        it has one. Existing <code className="font-mono text-xs">[[links]]</code>{" "}
        resolve as soon as the notes they point at are imported too.
      </p>
      <MarkdownImportForm />

      <h2 className="mb-2 mt-6 text-xs font-semibold text-text-faint">
        From a vault zip
      </h2>
      <p className="mb-2 text-sm text-text-muted">
        A zip of Markdown files: the vault you can download from Settings, or a
        folder from Obsidian that you zipped. You see what would happen before
        anything is saved. A note you already have is left alone, so importing
        the same file again adds nothing, and a note that shares its title with
        a different one of yours comes in as &ldquo;Title (imported)&rdquo;.
        Notes that Anamnesis wrote get their course and project back when you
        still have ones with the same code and title. One run adds at most 500
        notes; import the same file again for the rest.
      </p>
      <VaultImportForm />
    </div>
  );
}
