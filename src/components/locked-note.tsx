"use client";

import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { changeLockPasswordAction, lockNowAction, removeLockAction, saveLockedNoteAction, unlockNoteAction } from "@/actions/note-lock";
import { MAX_NOTE_LENGTH } from "@/lib/see-also";
import { Icon } from "@/components/icons";
import type { LockVia } from "@/lib/note-lock";

const FIELD = "min-h-11 w-full min-w-0 rounded-lg border border-control bg-surface px-3 text-sm text-text focus:border-accent focus:outline-none";
const BUTTON = "inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors disabled:opacity-60";

/**
 * A locked note's page (ROADMAP 58). Locked, it is only a title and a password box. Unlocked in this browser (a five-minute cookie the server checks),
 * it shows the text and a plain editor; the page has none of the cards that read a note's text (related notes, summary, cards, translation).
 */
export function LockedNote({ noteId, title, unlocked, via, text, body }: { noteId: string; title: string; unlocked: boolean; via: LockVia; text: string | null; body: ReactNode }) {
  const router = useRouter();
  const id = useId();
  const busy = useRef(false);
  const [pending, startTransition] = useTransition();
  const [typed, setTyped] = useState("");
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftText, setDraftText] = useState(text ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  function run(task: () => Promise<{ success: boolean; error?: { message: string } | null }>, done: string, after?: () => void) {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    setStatus("");
    startTransition(async () => {
      try {
        const response = await task();
        if (!response.success) return void setError(response.error?.message ?? "That did not work.");
        if (done) setStatus(done);
        after?.();
        router.refresh();
      } catch {
        setError("Could not reach the server. Try again.");
      } finally {
        busy.current = false;
      }
    });
  }

  if (!unlocked) {
    const ask = via === "account" ? "Enter your sign-in password to view this note." : "Enter this note's password to view it.";
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-3 px-2 text-center">
        <Icon name="lock" className="size-20 text-text-faint" />
        <h1 className="text-2xl font-bold tracking-tight text-text">This note is locked.</h1>
        <p className="text-sm text-text-muted"><span className="font-semibold text-text">{title}</span></p>
        <p className="text-base text-text">{ask}</p>
        <form onSubmit={(event) => { event.preventDefault(); const value = typed; run(() => unlockNoteAction(noteId, value), "", () => setTyped("")); }} className="flex w-full max-w-sm flex-col gap-2">
          <label htmlFor={`${id}-u`} className="sr-only">{via === "account" ? "Sign-in password or recovery key" : "Password or recovery key"}</label>
          <input id={`${id}-u`} type="password" autoComplete="off" value={typed} onChange={(event) => setTyped(event.target.value)} maxLength={200} placeholder="Password or recovery key" className={`${FIELD} text-center`} />
          {error && <p role="alert" className="text-[13px] font-semibold text-danger">{error}</p>}
          <button type="submit" disabled={pending || typed === ""} className={`${BUTTON} bg-accent text-on-accent hover:bg-accent-hover`}>{pending ? "Unlocking…" : "Unlock"}</button>
          <p className="text-xs text-text-muted">It stays open in this browser for five minutes, then locks again by itself.</p>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight text-text">{title}</h1>
        <button type="button" disabled={pending} onClick={() => run(() => lockNowAction(noteId), "")} className={`${BUTTON} gap-1.5 border border-border-strong text-text hover:bg-surface-subtle`}><Icon name="lock" className="size-4" />Lock now</button>
      </div>
      <p className="mt-1 text-sm text-text-muted">Unlocked in this browser. It locks again by itself after five minutes. This page offers no summary, translation, cards or suggestions: they would have to read the text.</p>

      {editing ? (
        <form onSubmit={(event) => { event.preventDefault(); run(() => saveLockedNoteAction(noteId, draftTitle, draftText), "Saved.", () => setEditing(false)); }} className="mt-4 flex flex-col gap-3">
          <label htmlFor={`${id}-t`} className="text-[13px] font-semibold text-text">Title</label>
          <input id={`${id}-t`} value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} maxLength={200} className={FIELD} />
          <label htmlFor={`${id}-c`} className="text-[13px] font-semibold text-text">Text</label>
          <textarea id={`${id}-c`} value={draftText} onChange={(event) => setDraftText(event.target.value)} rows={16} maxLength={MAX_NOTE_LENGTH * 2} className={`${FIELD} py-2 font-mono`} />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending} className={`${BUTTON} bg-accent text-on-accent hover:bg-accent-hover`}>{pending ? "Saving…" : "Save"}</button>
            <button type="button" disabled={pending} onClick={() => { setEditing(false); setDraftTitle(title); setDraftText(text ?? ""); }} className={`${BUTTON} border border-border-strong text-text hover:bg-surface-subtle`}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <div className="mt-4 rounded-xl border border-border-subtle bg-surface p-4">{body}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => { setDraftTitle(title); setDraftText(text ?? ""); setEditing(true); }} className={`${BUTTON} border border-border-strong text-text hover:bg-surface-subtle`}>Edit</button>
          </div>
        </>
      )}

      <section aria-label="Lock settings" className="mt-6 flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-4">
        <h2 className="text-sm font-semibold text-text">Lock settings</h2>
        <form onSubmit={(event) => { event.preventDefault(); const value = newPassword; run(() => changeLockPasswordAction(noteId, value), "Password changed. The recovery key is the same as before.", () => setNewPassword("")); }} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor={`${id}-n`} className="text-[13px] font-semibold text-text">New password</label>
            <input id={`${id}-n`} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} maxLength={200} className={FIELD} />
          </div>
          <button type="submit" disabled={pending || newPassword === ""} className={`${BUTTON} border border-border-strong text-text hover:bg-surface-subtle`}>Change password</button>
        </form>
        <div>
          <button type="button" disabled={pending} onClick={() => { if (window.confirm("Remove the lock? The note's text is stored unencrypted again, searchable and readable by the assistant.")) run(() => removeLockAction(noteId), ""); }} className={`${BUTTON} border border-danger text-danger hover:bg-danger-soft`}>Remove the lock</button>
        </div>
        <p role="status" className="text-[13px] text-text-muted empty:hidden">{status}</p>
        {error && <p role="alert" className="text-[13px] font-semibold text-danger">{error}</p>}
      </section>
    </div>
  );
}
