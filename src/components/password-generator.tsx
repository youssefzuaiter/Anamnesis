"use client";

import { useId, useState } from "react";
import { generatePassphrase, generatePassword, passphraseBits, passwordBits, strengthLabel, type PassphraseOptions, type PasswordOptions } from "@/lib/password-generator";

const fill = (array: Uint32Array) => crypto.getRandomValues(array);
const FIELD = "min-h-11 w-full min-w-0 rounded-lg border border-control bg-surface px-3 text-sm text-text focus:border-accent focus:outline-none";
const BUTTON = "inline-flex min-h-11 items-center justify-center rounded-lg border border-border-strong px-4 text-sm font-semibold text-text transition-colors hover:bg-surface-subtle disabled:opacity-60";

type Mode = "password" | "passphrase";

/**
 * A password and passphrase generator (ROADMAP item 59). It runs entirely in this page with `crypto.getRandomValues`: nothing is generated on the server,
 * stored, logged or sent, and what it makes is gone when the page is. It is not a password manager.
 */
export function PasswordGenerator({ onUse }: { onUse?: (password: string) => void }) {
  const id = useId();
  const [mode, setMode] = useState<Mode>("passphrase");
  const [pw, setPw] = useState<PasswordOptions>({ length: 20, lower: true, upper: true, digits: true, symbols: false, avoidLookalikes: true });
  const [phrase, setPhrase] = useState<PassphraseOptions>({ words: 6, separator: "-", capitalize: false, addNumber: false });
  const [value, setValue] = useState("");
  const [bits, setBits] = useState(0);
  const [shown, setShown] = useState(true);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function make(nextMode: Mode, nextPw: PasswordOptions, nextPhrase: PassphraseOptions) {
    setError(null);
    setNote("");
    try {
      if (nextMode === "password") {
        setValue(generatePassword(nextPw, fill));
        setBits(passwordBits(nextPw));
      } else {
        setValue(generatePassphrase(nextPhrase, fill));
        setBits(passphraseBits(nextPhrase));
      }
    } catch (failure) {
      setValue("");
      setError(failure instanceof Error ? failure.message : "Could not make one.");
    }
  }

  const changePw = (patch: Partial<PasswordOptions>) => {
    const next = { ...pw, ...patch };
    setPw(next);
    make("password", next, phrase);
  };
  const changePhrase = (patch: Partial<PassphraseOptions>) => {
    const next = { ...phrase, ...patch };
    setPhrase(next);
    make("passphrase", pw, next);
  };
  const pick = (next: Mode) => {
    setMode(next);
    make(next, pw, phrase);
  };

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setNote("Copied. Paste it into a password field or a safe place; this page does not keep it.");
    } catch {
      setNote("Could not copy automatically. Select the text and copy it.");
    }
  }

  const checks: [keyof PasswordOptions, string][] = [
    ["lower", "a–z"],
    ["upper", "A–Z"],
    ["digits", "0–9"],
    ["symbols", "Symbols"],
    ["avoidLookalikes", "Leave out look-alikes (0 O 1 l I)"],
  ];

  return (
    <section aria-label="Password generator" className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-4">
      <div role="group" aria-label="Kind" className="inline-flex gap-1 self-start rounded-xl bg-surface-subtle p-1">
        {(["passphrase", "password"] as const).map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => pick(m)} className={`inline-flex min-h-11 items-center rounded-lg px-4 text-[13px] font-semibold transition-colors sm:min-h-9 ${mode === m ? "bg-accent text-on-accent" : "text-text-muted hover:bg-surface-hover"}`}>
            {m === "passphrase" ? "Passphrase" : "Password"}
          </button>
        ))}
      </div>

      {mode === "password" ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-len`} className="text-[13px] font-semibold text-text">Length: {pw.length}</label>
            <input id={`${id}-len`} type="range" min={8} max={64} value={pw.length} onChange={(event) => changePw({ length: Number(event.target.value) })} className="min-h-11 w-full accent-[var(--accent)]" />
          </div>
          <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
            <legend className="sr-only">Characters</legend>
            {checks.map(([key, label]) => (
              <label key={key} className="flex min-h-11 items-center gap-2 text-sm text-text">
                <input type="checkbox" checked={pw[key] as boolean} onChange={(event) => changePw({ [key]: event.target.checked })} className="h-5 w-5 accent-[var(--accent)]" />
                {label}
              </label>
            ))}
          </fieldset>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-words`} className="text-[13px] font-semibold text-text">Words: {phrase.words}</label>
            <input id={`${id}-words`} type="range" min={3} max={12} value={phrase.words} onChange={(event) => changePhrase({ words: Number(event.target.value) })} className="min-h-11 w-full accent-[var(--accent)]" />
          </div>
          <div className="flex flex-col gap-1 sm:max-w-xs">
            <label htmlFor={`${id}-sep`} className="text-[13px] font-semibold text-text">Between words</label>
            <select id={`${id}-sep`} value={phrase.separator} onChange={(event) => changePhrase({ separator: event.target.value })} className={FIELD}>
              <option value="-">A hyphen: -</option>
              <option value=" ">A space</option>
              <option value=".">A full stop: .</option>
              <option value="">Nothing</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-x-4">
            <label className="flex min-h-11 items-center gap-2 text-sm text-text">
              <input type="checkbox" checked={phrase.capitalize} onChange={(event) => changePhrase({ capitalize: event.target.checked })} className="h-5 w-5 accent-[var(--accent)]" />
              Capital letters
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm text-text">
              <input type="checkbox" checked={phrase.addNumber} onChange={(event) => changePhrase({ addNumber: event.target.checked })} className="h-5 w-5 accent-[var(--accent)]" />
              A digit at the end
            </label>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-out`} className="text-[13px] font-semibold text-text">Result</label>
        <input id={`${id}-out`} readOnly type={shown ? "text" : "password"} value={value} placeholder="Press Make one" autoComplete="off" spellCheck={false} className={`${FIELD} font-mono`} />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => make(mode, pw, phrase)} className={`${BUTTON} bg-accent text-on-accent hover:bg-accent-hover`}>{value ? "Make another" : "Make one"}</button>
          <button type="button" onClick={() => void copy()} disabled={value === ""} className={BUTTON}>Copy</button>
          <button type="button" onClick={() => setShown(!shown)} disabled={value === ""} className={BUTTON}>{shown ? "Hide" : "Show"}</button>
          {onUse && <button type="button" onClick={() => onUse(value)} disabled={value === ""} className={BUTTON}>Use this</button>}
        </div>
        {value !== "" && (
          <p data-testid="strength" className="text-[13px] text-text-muted">
            <strong className="text-text">{strengthLabel(bits)}</strong>: about {Math.round(bits)} bits of entropy, which is about 2<sup>{Math.round(bits)}</sup> equally likely possibilities.
          </p>
        )}
        <p role="status" className="text-[13px] text-text-muted empty:hidden">{note}</p>
        {error && <p role="alert" className="text-[13px] font-semibold text-danger">{error}</p>}
      </div>

      <p className="text-xs text-text-muted">Made in this page with your browser&apos;s random number generator. Nothing is sent to the server, saved or logged, and the app does not keep passwords: it is not a password manager. Write down or save a password you will need again.</p>
    </section>
  );
}
