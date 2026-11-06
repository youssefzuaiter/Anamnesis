"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ApiResponse } from "@/lib/api-response";
import type { VaultImportReport } from "@/services/vault-service";

/** Lists in a preview show this many lines and then say how many more there are. */
const SHOWN = 10;

type Phase =
  | { name: "idle" }
  | { name: "working"; mode: "preview" | "apply" }
  | { name: "previewed"; report: VaultImportReport }
  | { name: "done"; report: VaultImportReport }
  | { name: "failed"; message: string };

const plural = (count: number, one: string, many: string) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

function More({ total }: { total: number }) {
  return total > SHOWN ? <li className="text-text-muted">…and {(total - SHOWN).toLocaleString("en-US")} more</li> : null;
}

/** What a check found, in words. Every number comes from the server's report; every name is shown as text. */
function Findings({ report }: { report: VaultImportReport }) {
  const { notes, attachments } = report;
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-text">
      {!report.apply && notes.create > 0 && (
        <li>
          Would add <strong>{plural(notes.create, "note", "notes")}</strong>.
        </li>
      )}
      {notes.present > 0 && (
        <li>
          {plural(notes.present, "note is", "notes are")} already in your notes (the same title and the same text), so{" "}
          {notes.present === 1 ? "it is" : "they are"} left alone.
        </li>
      )}
      {notes.renamed.length > 0 && (
        <li>
          {plural(notes.renamed.length, "note comes", "notes come")} in under a new title, because you already have a different note with that
          title. Your existing note keeps the title and the links to it:
          <ul className="mt-1 flex list-[circle] flex-col gap-1 pl-5">
            {notes.renamed.slice(0, SHOWN).map((r, i) => (
              <li key={i} className="break-words">
                “{r.from}” as “{r.to}”
              </li>
            ))}
            <More total={notes.renamed.length} />
          </ul>
        </li>
      )}
      {notes.deferred > 0 && (
        <li>
          {plural(notes.deferred, "more note is", "more notes are")} left for the next run: one run adds at most 500 notes and reads at most 400 MB of
          attachments. Import the same file again afterwards; nothing is added twice.
        </li>
      )}
      {notes.failed > 0 && <li>{plural(notes.failed, "note could", "notes could")} not be saved. Importing the same file again tries them again.</li>}
      {notes.withoutCourse > 0 && (
        <li>{plural(notes.withoutCourse, "note has", "notes have")} no course here: no course of yours has the code they name, or more than one does.</li>
      )}
      {notes.withoutProject > 0 && (
        <li>{plural(notes.withoutProject, "note has", "notes have")} no project here: none of yours has the title they name, or more than one does.</li>
      )}
      {attachments.stored > 0 && (
        <li>
          {report.apply ? "Stored" : "Would store"} <strong>{plural(attachments.stored, "attachment", "attachments")}</strong>.
        </li>
      )}
      {attachments.unreferenced > 0 && (
        <li>
          {plural(attachments.unreferenced, "file in attachments/ is", "files in attachments/ are")} not listed by any note, so{" "}
          {attachments.unreferenced === 1 ? "it is" : "they are"} not imported (only notes written by Anamnesis list their attachments).
        </li>
      )}
      {attachments.rejected.length > 0 && (
        <li>
          {plural(attachments.rejectedTotal, "attachment is", "attachments are")} not imported:
          <ul className="mt-1 flex list-[circle] flex-col gap-1 pl-5">
            {attachments.rejected.slice(0, SHOWN).map((r, i) => (
              <li key={i} className="break-words">
                {r.name}: {r.reason}
              </li>
            ))}
            <More total={attachments.rejectedTotal} />
          </ul>
        </li>
      )}
      {report.skippedTotal > 0 && (
        <li>
          {plural(report.skippedTotal, "file is", "files are")} skipped:
          <ul className="mt-1 flex list-[circle] flex-col gap-1 pl-5">
            {report.skipped.slice(0, SHOWN).map((s, i) => (
              <li key={i} className="break-words">
                {s.path}: {s.reason}
              </li>
            ))}
            <More total={report.skippedTotal} />
          </ul>
        </li>
      )}
      {report.droppedProperties > 0 && (
        <li>
          {plural(report.droppedProperties, "note has", "notes have")} front matter properties this app has no place for. Their tags are kept and the
          rest is not.
        </li>
      )}
      {report.ignored > 0 && <li>{plural(report.ignored, "other file is", "other files are")} ignored (hidden folders, and anything that is not a note or an attachment).</li>}
    </ul>
  );
}

const primary =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60";
const quiet =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-control px-4 py-2.5 text-sm font-medium text-text transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-60";

export function VaultImportForm() {
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [file, setFile] = useState<File | null>(null);
  const busy = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const result = useRef<HTMLDivElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);

  // A result takes focus, so a keyboard or screen reader user lands on what happened.
  useEffect(() => {
    if (phase.name === "previewed" || phase.name === "done") result.current?.focus();
    if (phase.name === "failed") alert.current?.focus();
  }, [phase.name]);

  async function send(mode: "preview" | "apply") {
    if (!file || busy.current) return;
    busy.current = true;
    setPhase({ name: "working", mode });
    try {
      const response = await fetch(`/api/import/vault?mode=${mode}`, { method: "POST", body: file, headers: { "Content-Type": "application/zip" } });
      const body = (await response.json()) as ApiResponse<VaultImportReport>;
      if (!body.success) setPhase({ name: "failed", message: body.error.message });
      else setPhase(mode === "preview" ? { name: "previewed", report: body.data } : { name: "done", report: body.data });
    } catch {
      setPhase({
        name: "failed",
        message:
          mode === "apply"
            ? "The connection was lost. Some notes may already have been imported: choose the same file and check it again to see what is left. Nothing is added twice."
            : "Could not reach the server. Try again.",
      });
    } finally {
      busy.current = false;
    }
  }

  function chooseAnother() {
    setFile(null);
    setPhase({ name: "idle" });
    if (input.current) input.current.value = "";
    input.current?.focus();
  }

  const working = phase.name === "working";
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-4">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-text">Vault zip</span>
        <input
          ref={input}
          type="file"
          accept=".zip,application/zip"
          aria-label="Vault zip"
          disabled={working}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setPhase({ name: "idle" });
          }}
          className="w-full rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2 text-sm text-text file:mr-3 file:rounded-md file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-accent"
        />
      </label>

      {(phase.name === "idle" || (working && phase.mode === "preview")) && (
        <div>
          <button type="button" onClick={() => send("preview")} disabled={!file || working} className={primary}>
            {working ? "Checking…" : "Check the file"}
          </button>
          <p className="mt-2 text-xs text-text-muted">Nothing is saved by checking: you see what an import would do first.</p>
        </div>
      )}

      <div ref={result} role="status" tabIndex={-1} className="-m-2 rounded-lg p-2 outline-none">
        {phase.name === "previewed" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-text">
              {phase.report.notes.create > 0 ? "This is what importing would do." : "There is nothing new to import."}
            </p>
            <Findings report={phase.report} />
          </div>
        )}
        {phase.name === "done" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-text">
              Imported {plural(phase.report.notes.created, "note", "notes")}
              {phase.report.attachments.stored > 0 ? ` and ${plural(phase.report.attachments.stored, "attachment", "attachments")}` : ""}.
            </p>
            <Findings report={phase.report} />
            <p className="text-sm text-text-muted">
              If search does not find them yet, rebuild the search index in{" "}
              <Link href="/settings" className="text-accent hover:underline">
                Settings
              </Link>
              : a note saved while the local model was stopped is left out of semantic search until then.
            </p>
          </div>
        )}
        {working && phase.mode === "apply" && <p className="text-sm text-text-muted">Importing… this can take a while for a large vault.</p>}
      </div>

      {phase.name === "failed" && (
        <p ref={alert} role="alert" tabIndex={-1} className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger outline-none">
          {phase.message}
        </p>
      )}

      {(phase.name === "previewed" || (working && phase.mode === "apply")) && (
        <div className="flex flex-wrap gap-2">
          {phase.name === "previewed" && phase.report.notes.create > 0 && (
            <button type="button" onClick={() => send("apply")} className={primary}>
              Import {plural(phase.report.notes.create, "note", "notes")}
            </button>
          )}
          {working && (
            <button type="button" disabled className={primary}>
              Importing…
            </button>
          )}
          <button type="button" onClick={chooseAnother} disabled={working} className={quiet}>
            Choose another file
          </button>
        </div>
      )}
      {phase.name === "done" && (
        <div className="flex flex-wrap gap-2">
          <Link href="/notes" className={primary}>
            Open notes
          </Link>
          <button type="button" onClick={chooseAnother} className={quiet}>
            Import another file
          </button>
        </div>
      )}
      {phase.name === "failed" && (
        <div>
          <button type="button" onClick={chooseAnother} className={quiet}>
            Choose another file
          </button>
        </div>
      )}
    </div>
  );
}
