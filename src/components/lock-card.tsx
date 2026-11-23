"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { lockNoteAction } from "@/actions/note-lock";
import { MIN_PASSWORD, type LockVia } from "@/lib/note-lock";
import { Icon } from "@/components/icons";
import { PasswordGenerator } from "@/components/password-generator";

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

const FIELD = "min-h-11 w-full min-w-0 rounded-lg border border-control bg-surface px-3 text-sm text-text focus:border-accent focus:outline-none";
const BUTTON = "inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors disabled:opacity-60";

/**
 * The lock icon in a note's toolbar (ROADMAP 58, the way the Notes app does it): it opens a dialog that asks for a password. The default is the account's
 * own sign-in password (typed once, checked against the account so a slip cannot lock a note behind a password nobody has); "a different password" makes one
 * for this note. Locking is one step; the recovery key it makes is shown here, once, and the page only moves on after the person says they saved it (the
 * note is already locked by then; a save of the open editor would be refused).
 */
export function LockButton({ noteId, title, blocked }: { noteId: string; title: string; blocked: string | null }) {
  const router = useRouter();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const [pending, startTransition] = useTransition();
  const [how, setHow] = useState<LockVia>("account");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function open() {
    setError(null);
    dialog.current?.showModal();
  }
  function close() {
    dialog.current?.close();
  }

  function lock() {
    if (busy.current) return;
    if (how === "own") {
      if (password.length < MIN_PASSWORD) return void setError(`Use at least ${MIN_PASSWORD} characters.`);
      if (password !== again) return void setError("The two passwords differ.");
    } else if (password === "") {
      return void setError("Type your sign-in password.");
    }
    busy.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const response = await lockNoteAction(noteId, password, how);
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

  return (
    <>
      <button type="button" onClick={open} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 font-medium transition-colors hover:text-text sm:min-h-0">
        <Icon name="lock" className="size-4" />
        Lock
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-h`}
        // A dismissed dialog after locking must not leave the open note standing: the note is locked, so the page is refreshed to show it so.
        onClose={() => { if (recoveryKey) router.refresh(); }}
        className="m-auto w-[min(92vw,28rem)] rounded-2xl border border-border-subtle bg-surface p-0 text-text shadow-card backdrop:bg-black/40"
      >
        {recoveryKey ? (
          <div className="flex flex-col gap-3 p-5">
            <h2 id={`${id}-h`} className="text-lg font-semibold">This note is locked</h2>
            <p className="text-sm">Save its recovery key now: it is shown only this once, and without it a forgotten password cannot be recovered.</p>
            <p data-testid="recovery-key" className="break-all rounded-lg bg-surface-subtle px-3 py-2 font-mono text-sm font-semibold tracking-wide">{recoveryKey}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void navigator.clipboard?.writeText(recoveryKey)} className={`${BUTTON} border border-border-strong hover:bg-surface-subtle`}>Copy</button>
              <button type="button" onClick={() => printKey(title, recoveryKey)} className={`${BUTTON} border border-border-strong hover:bg-surface-subtle`}>Print</button>
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} className="h-5 w-5 accent-[var(--accent)]" />
              I have saved the recovery key
            </label>
            <button type="button" disabled={!saved} onClick={close} className={`${BUTTON} bg-accent text-on-accent hover:bg-accent-hover`}>Done</button>
          </div>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); lock(); }} className="flex flex-col gap-3 p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 id={`${id}-h`} className="flex items-center gap-2 text-lg font-semibold"><Icon name="lock" className="size-5" />Lock this note</h2>
              <button type="button" onClick={close} className="min-h-11 rounded-lg px-2 text-sm text-text-muted hover:text-text">Cancel</button>
            </div>
            {blocked ? (
              <p className="text-sm text-text-muted">{blocked}</p>
            ) : (
              <>
                <p className="text-sm text-text-muted">Its text is encrypted, so the database and its backups hold only scrambled text. A recovery key is shown next, in case the password is forgotten.</p>
                <fieldset className="flex flex-col gap-1">
                  <legend className="sr-only">Which password</legend>
                  <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
                    <input type="radio" name={`${id}-how`} checked={how === "account"} onChange={() => { setHow("account"); setError(null); }} className="h-4 w-4 accent-[var(--accent)]" />
                    Use my sign-in password
                  </label>
                  <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
                    <input type="radio" name={`${id}-how`} checked={how === "own"} onChange={() => { setHow("own"); setError(null); }} className="h-4 w-4 accent-[var(--accent)]" />
                    Use a different password for this note
                  </label>
                </fieldset>
                <label htmlFor={`${id}-p`} className="text-[13px] font-semibold">{how === "account" ? "Your sign-in password" : "Password for this note"}</label>
                <input id={`${id}-p`} type="password" autoComplete={how === "account" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} maxLength={200} className={FIELD} />
                {how === "own" && (
                  <>
                    <label htmlFor={`${id}-a`} className="text-[13px] font-semibold">Password again</label>
                    <input id={`${id}-a`} type="password" autoComplete="new-password" value={again} onChange={(event) => setAgain(event.target.value)} maxLength={200} className={FIELD} />
                    <p className="text-xs text-text-muted">At least {MIN_PASSWORD} characters.</p>
                    <details className="rounded-lg border border-border-subtle p-2">
                      <summary className="min-h-11 cursor-pointer py-2.5 text-[13px] font-semibold">Make a strong password</summary>
                      <div className="mt-2 flex flex-col gap-2">
                        <PasswordGenerator onUse={(made) => { setPassword(made); setAgain(made); setError(null); }} />
                        <p className="text-xs text-text-muted">This password is not kept anywhere you can read it back. Write down what you use, with the recovery key shown next.</p>
                      </div>
                    </details>
                  </>
                )}
                {how === "account" && <p className="text-xs text-text-muted">The note opens with this same password. It is checked against your account now, so a typing slip cannot lock the note behind a password nobody has. Save any edits first: only what is already saved is locked.</p>}
                {error && <p role="alert" className="text-[13px] font-semibold text-danger">{error}</p>}
                <button type="submit" disabled={pending} className={`${BUTTON} bg-accent text-on-accent hover:bg-accent-hover`}>{pending ? "Locking…" : "Lock note"}</button>
              </>
            )}
          </form>
        )}
      </dialog>
    </>
  );
}
