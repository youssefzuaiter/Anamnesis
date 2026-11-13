"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  beginTwoFactorAction,
  confirmTwoFactorAction,
  disableTwoFactorAction,
  regenerateRecoveryCodesAction,
} from "@/actions/two-factor";

const button =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";
const primary = `${button} bg-accent text-on-accent hover:bg-accent-hover`;
const quiet = `${button} border border-control text-text hover:bg-surface-subtle`;
const danger = `${button} border border-danger text-danger hover:bg-danger-soft`;
const input =
  "min-h-11 w-full rounded-lg border border-control bg-surface px-3 text-[15px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none";

type Setup = { secret: string; uri: string; qrSvg: string };
type Change = "regenerate" | "disable" | null;

export function TwoFactorCard({ enabled, recoveryCodesLeft }: { enabled: boolean; recoveryCodesLeft: number }) {
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  // The recovery codes exist here only, from the moment they are made until the person says they saved
  // them: the server keeps hashes it cannot turn back into codes.
  const [codes, setCodes] = useState<string[] | null>(null);
  const [change, setChange] = useState<Change>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);

  async function run(work: () => Promise<void>) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }

  const begin = () =>
    run(async () => {
      const result = await beginTwoFactorAction();
      if (!result.success) return setError(result.error.message);
      setSetup(result.data);
      setStatus("");
    });

  const confirm = (form: HTMLFormElement) =>
    run(async () => {
      const code = String(new FormData(form).get("code") ?? "");
      const result = await confirmTwoFactorAction({ code });
      if (!result.success) return setError(result.error.message);
      setSetup(null);
      setCodes(result.data.recoveryCodes);
      setStatus("Done: your next sign-in will ask for a code.");
      router.refresh();
    });

  const submitChange = (form: HTMLFormElement) =>
    run(async () => {
      const data = new FormData(form);
      const payload = { password: String(data.get("password") ?? ""), code: String(data.get("code") ?? "") };
      if (change === "disable") {
        const result = await disableTwoFactorAction(payload);
        if (!result.success) return setError(result.error.message);
        setChange(null);
        setCodes(null);
        setStatus("Two-factor sign-in is off.");
      } else {
        const result = await regenerateRecoveryCodesAction(payload);
        if (!result.success) return setError(result.error.message);
        setChange(null);
        setCodes(result.data.recoveryCodes);
        setStatus("New recovery codes made. The old ones no longer work.");
      }
      router.refresh();
    });

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText((codes ?? []).join("\n"));
      setStatus("Recovery codes copied.");
    } catch {
      setStatus("Select the codes and copy them.");
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-4 text-sm">
      <p className="text-text-muted">
        Ask for a 6-digit code from an authenticator app (1Password, Google Authenticator, Authy and others) as well as your password. Each code works
        once, and a lost phone is covered by one-time recovery codes.
      </p>

      {codes && (
        <section aria-labelledby="recovery-title" className="flex flex-col gap-2 rounded-lg border border-warn bg-warn-soft p-3">
          <h3 id="recovery-title" className="font-medium text-text">
            Your recovery codes
          </h3>
          <p className="text-xs text-text-muted">
            Each works once, in place of the authenticator code. <strong className="font-medium text-text">They are shown only now</strong>: keep them
            somewhere that is not this phone or computer alone.
          </p>
          <ul aria-label="Recovery codes" className="grid grid-cols-1 gap-1 font-mono text-sm text-text sm:grid-cols-2">
            {codes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copyCodes} className={quiet}>
              Copy codes
            </button>
            <button type="button" onClick={() => setCodes(null)} className={primary}>
              I have saved them
            </button>
          </div>
        </section>
      )}

      {!enabled && !setup && (
        <div>
          <button type="button" onClick={begin} disabled={busy} className={primary}>
            Set up two-factor sign-in
          </button>
        </div>
      )}

      {!enabled && setup && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void confirm(event.currentTarget);
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-text-muted">
            <strong className="font-medium text-text">1.</strong> Scan this with your authenticator app, or type the key in by hand.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL made on the server; there is nothing to optimise */}
          <img
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(setup.qrSvg)}`}
            alt="Setup code for your authenticator app"
            width={200}
            height={200}
            className="h-[200px] w-[200px] max-w-full rounded-lg border border-border-subtle"
          />
          <label className="block">
            <span className="mb-1.5 block font-medium text-text">Setup key</span>
            <textarea readOnly rows={2} value={setup.secret} onFocus={(event) => event.currentTarget.select()} className={`${input} resize-none py-2 font-mono text-sm leading-6`} />
          </label>
          <label className="block">
            <span className="mb-1.5 block font-medium text-text">2. Enter the 6-digit code it shows</span>
            <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={12} required placeholder="123456" className={input} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className={primary}>
              Turn on
            </button>
            <button type="button" onClick={() => setSetup(null)} disabled={busy} className={quiet}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {enabled && (
        <>
          <p className="text-text">
            <strong className="font-medium">Two-factor sign-in is on.</strong>{" "}
            <span className="text-text-muted">
              {recoveryCodesLeft} recovery code{recoveryCodesLeft === 1 ? "" : "s"} left.
            </span>
          </p>
          {!change && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setChange("regenerate")} className={quiet}>
                Make new recovery codes
              </button>
              <button type="button" onClick={() => setChange("disable")} className={danger}>
                Turn off
              </button>
            </div>
          )}
          {change && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submitChange(event.currentTarget);
              }}
              className="flex flex-col gap-3"
            >
              <p className="text-text-muted">
                {change === "disable" ? "Turning it off" : "Making new recovery codes"} needs your password and a current code.
              </p>
              <label className="block">
                <span className="mb-1.5 block font-medium text-text">Password</span>
                <input name="password" type="password" autoComplete="current-password" required className={input} />
              </label>
              <label className="block">
                <span className="mb-1.5 block font-medium text-text">Authenticator or recovery code</span>
                <input name="code" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} required maxLength={100} className={input} />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={busy} className={change === "disable" ? danger : primary}>
                  {change === "disable" ? "Turn off two-factor" : "Make new codes"}
                </button>
                <button type="button" onClick={() => { setChange(null); setError(null); }} disabled={busy} className={quiet}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-danger">
          {error}
        </p>
      )}
      <p role="status" className="text-xs text-text-muted">
        {status}
      </p>
    </div>
  );
}
