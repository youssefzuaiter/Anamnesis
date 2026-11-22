"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { lockNoteAction } from "@/actions/note-lock";
import { MIN_PASSWORD } from "@/lib/note-lock";

/** Prints or saves the recovery key without the rest of the page: a hidden frame with only the key in it. */
function printKey(title: string, key: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) return void frame.remove();
  const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  doc.open();
  doc.write(`<!doctype html><title>Recovery key</title><body style="font-family:system-ui;padding:32px"><h1>Recovery key</h1><p>For the locked note “${escape(title)}”. Keep it somewhere safe and private: it opens the note if the password is forgotten, and nothing else can.</p><p style="font:600 22px ui-monospace,monospace;letter-spacing:.05em">${escape(key)}</p></body>`);
  doc.close();
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
  setTimeout(() => frame.remove(), 1000);
}

/**
 * "Lock this note" (ROADMAP 58) in the note's side rail. Locking is one step; the recovery key it makes is shown here, once, and the page only moves on
 * after the person says they saved it (the note is already locked by then; a save of the open editor would be refused).
 */
export function LockCard({ noteId, title, blocked }: { noteId: string; title: string; blocked: string | null }) {
  const router = useRouter();
  const id = useId();
  const busy = useRef(false);
  const [pending, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function lock() {
    if (busy.current) return;
    if (password.length < MIN_PASSWORD) return void setError(`Use at least ${MIN_PASSWORD} characters.`);
    if (password !== again) return void setError("The two passwords differ.");
    busy.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const response = await lockNoteAction(noteId, password);
        if (!response.success) return void setError(response.error.message);
        setPassword("");
        setAgain("");
        setRecoveryKey(response.data.recoveryKey);
      } catch {
        setError("Could not reach the server. Try again.");
      } finally {
        busy.current = false;
      }
    });
  }

  if (recoveryKey) {
    return (
      <div>
        <h2 className="text-xs font-semibold text-text-faint">Locked</h2>
        <p className="mt-1.5 text-sm text-text">This note is locked. Save its recovery key now: it is shown only this once, and without it a forgotten password cannot be recovered.</p>
        <p data-testid="recovery-key" className="mt-2 break-all rounded-lg bg-surface-subtle px-3 py-2 font-mono text-sm font-semibold tracking-wide text-text">{recoveryKey}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => void navigator.clipboard?.writeText(recoveryKey)} className="min-h-11 rounded-lg border border-border-subtle bg-surface px-3 text-sm text-text hover:bg-surface-subtle">Copy</button>
          <button type="button" onClick={() => printKey(title, recoveryKey)} className="min-h-11 rounded-lg border border-border-subtle bg-surface px-3 text-sm text-text hover:bg-surface-subtle">Print</button>
        </div>
        <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-text">
          <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} className="h-5 w-5 accent-[var(--accent)]" />
          I have saved the recovery key
        </label>
        <button type="button" disabled={!saved} onClick={() => router.refresh()} className="mt-2 min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60">Done</button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xs font-semibold text-text-faint">Lock</h2>
      <p className="mt-1.5 text-sm text-text-muted">Encrypts this note with its own password, so the database and its backups hold only scrambled text. A forgotten password cannot be recovered without the recovery key shown next.</p>
      {blocked ? (
        <p className="mt-2 text-xs text-text-muted">{blocked}</p>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); lock(); }} className="mt-2.5 flex flex-col gap-2">
          <label htmlFor={`${id}-p`} className="text-[13px] font-semibold text-text">Password</label>
          <input id={`${id}-p`} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} maxLength={200} className="min-h-11 w-full min-w-0 rounded-lg border border-control bg-surface px-3 text-sm text-text focus:border-accent focus:outline-none" />
          <label htmlFor={`${id}-a`} className="text-[13px] font-semibold text-text">Password again</label>
          <input id={`${id}-a`} type="password" autoComplete="new-password" value={again} onChange={(event) => setAgain(event.target.value)} maxLength={200} className="min-h-11 w-full min-w-0 rounded-lg border border-control bg-surface px-3 text-sm text-text focus:border-accent focus:outline-none" />
          <p className="text-xs text-text-muted">At least {MIN_PASSWORD} characters. Save any edits first: only what is already saved is locked.</p>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <button type="submit" disabled={pending} className="min-h-11 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-text transition-colors hover:bg-surface-subtle disabled:opacity-60">{pending ? "Locking…" : "Lock this note"}</button>
        </form>
      )}
    </div>
  );
}
