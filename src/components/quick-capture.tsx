"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { confirmCaptureAction } from "@/actions/capture";
import type { Proposal } from "@/services/parse-service";
import { Icon } from "@/components/icons";

// The Web Speech API has no official TypeScript DOM types — this is the
// minimal shape actually used here, not the full spec surface. Free and
// entirely client-side (no server, no API key); unsupported browsers (all of
// Firefox, at the time of writing) just never see the mic button.
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike extends Event {
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

const KIND_LABEL: Record<Proposal["kind"], string> = {
  task: "Task",
  event: "Event",
  note: "Note",
};

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const DATE_ONLY = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

function describe(proposal: Proposal): string[] {
  if (proposal.kind === "task") {
    return [
      proposal.dueDate
        ? `Due ${DATE_ONLY.format(new Date(proposal.dueDate))}`
        : "No due date",
      `${proposal.priority} priority`,
      `${proposal.estimatedMinutes}m`,
    ];
  }
  if (proposal.kind === "event") {
    return [
      DATE_TIME.format(new Date(proposal.startTime)),
      `until ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(proposal.endTime))}`,
      ...(proposal.location ? [proposal.location] : []),
    ];
  }
  return ["Saved as a note"];
}

export function QuickCapture() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Cleanup only — nothing here calls setState, so mount/unmount is all this
  // effect does. Support itself is checked lazily in the click handler
  // instead of during render, so an unsupported browser never has to render
  // one thing on the server and another after hydration.
  useEffect(() => {
    return () => recognitionRef.current?.stop();
  }, []);

  function toggleListening() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError("Voice input isn't supported in this browser — try Chrome, Edge or Safari.");
      return;
    }

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join(" ")
        .trim();
      setText(transcript);
    };
    recognition.onerror = (event) => {
      if (event.error && event.error !== "no-speech" && event.error !== "aborted") {
        setError("Voice input failed — try typing instead.");
      }
      setListening(false);
    };
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    setError(null);
    setListening(true);
    recognition.start();
  }

  async function parse() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setError(null);
    setProposal(null);

    try {
      const response = await fetch("/api/ai/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      const body = await response.json();
      if (body.success) setProposal(body.data);
      else setError(body.error?.message ?? "Could not read that.");
    } catch {
      setError("Could not reach the parser.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!proposal || busy) return;

    setBusy(true);
    setError(null);
    const response = await confirmCaptureAction(proposal);
    setBusy(false);

    if (!response.success) {
      setError(response.error.message);
      return;
    }

    setText("");
    setProposal(null);
    router.push(response.data.href);
  }

  return (
    <section>
      {/* One bordered bar holds the field and its two buttons, and the ring
          sits on the bar, so the whole thing reads as a single control. */}
      <div className="flex items-center gap-2 rounded-2xl border border-control bg-surface py-1.5 pl-4 pr-1.5 shadow-card focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
        <Icon name="plus" className="size-[18px] text-text-faint" />
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              parse();
            }
          }}
          placeholder={
            listening
              ? "Listening…"
              : "Capture anything — “coffee with Ada friday 3pm”"
          }
          aria-label="Quick capture"
          disabled={busy}
          className="min-w-0 flex-1 bg-transparent py-2 text-[15px] text-text placeholder:text-text-faint focus:outline-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={toggleListening}
          disabled={busy}
          aria-label={listening ? "Stop voice input" : "Capture by voice"}
          aria-pressed={listening}
          title={listening ? "Stop listening" : "Capture by voice"}
          className={`inline-flex size-10 items-center justify-center rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            listening
              ? "animate-pulse bg-danger-soft text-danger"
              : "text-text-muted hover:bg-surface-subtle hover:text-text"
          }`}
        >
          <Icon name="mic" />
        </button>
        <button
          type="button"
          onClick={parse}
          disabled={busy || !text.trim()}
          className="min-h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy && !proposal ? "Reading…" : "Capture"}
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}

      {proposal && (
        <div
          role="status"
          className="mt-2 rounded-xl border border-[color-mix(in_srgb,var(--ai)_40%,var(--border))] bg-surface p-3.5"
        >
          <div className="flex items-start gap-3">
            <span className="shrink-0 rounded-full bg-ai-soft px-2 py-0.5 text-xs font-semibold text-ai">
              {KIND_LABEL[proposal.kind]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-text">
                {proposal.title}
              </p>
              <p className="mt-0.5 text-xs text-text-muted">
                {describe(proposal).join(" · ")}
              </p>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className="rounded-lg bg-accent px-3.5 py-1.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {busy ? "Saving…" : `Create ${KIND_LABEL[proposal.kind].toLowerCase()}`}
            </button>
            <button
              type="button"
              onClick={() => setProposal(null)}
              disabled={busy}
              className="rounded-lg px-3 py-1.5 text-sm text-text-muted transition-colors hover:text-text disabled:opacity-60"
            >
              Discard
            </button>
            <span className="ml-auto text-xs text-text-faint">
              Nothing is saved until you confirm
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
