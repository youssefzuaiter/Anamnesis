"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSignatureAction, saveSignatureAction } from "@/actions/signatures";
import { MAX_SIGNATURES, MAX_SIGNATURE_WIDTH, inkBounds } from "@/lib/signature";

export type SavedSignature = { id: string; name: string; width: number; height: number; createdAt: string };

type Point = { x: number; y: number };
type Stroke = { width: number; points: Point[] };

const SCALE = 2;
const CSS_HEIGHT = 220;
const PENS = [{ label: "Fine", width: 2 }, { label: "Medium", width: 3.5 }, { label: "Bold", width: 6 }] as const;
const BUTTON = "inline-flex min-h-11 items-center justify-center rounded-lg border border-border-strong px-4 text-sm font-semibold text-text transition-colors hover:bg-surface-subtle disabled:opacity-60";

function paint(context: CanvasRenderingContext2D, strokes: Stroke[]) {
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "#111111";
  context.fillStyle = "#111111";
  for (const stroke of strokes) {
    context.lineWidth = stroke.width * SCALE;
    const [first, ...rest] = stroke.points;
    if (!first) continue;
    if (rest.length === 0) {
      context.beginPath();
      context.arc(first.x * SCALE, first.y * SCALE, (stroke.width * SCALE) / 2, 0, Math.PI * 2);
      context.fill();
      continue;
    }
    context.beginPath();
    context.moveTo(first.x * SCALE, first.y * SCALE);
    // Curves through the midpoints, so a quick stroke is smooth rather than a polyline.
    for (let i = 0; i < rest.length - 1; i += 1) {
      const mid = { x: (rest[i].x + rest[i + 1].x) / 2, y: (rest[i].y + rest[i + 1].y) / 2 };
      context.quadraticCurveTo(rest[i].x * SCALE, rest[i].y * SCALE, mid.x * SCALE, mid.y * SCALE);
    }
    const last = rest[rest.length - 1];
    context.lineTo(last.x * SCALE, last.y * SCALE);
    context.stroke();
  }
}

/**
 * A drawing pad for a signature (ROADMAP 60). It is drawn here, trimmed to its ink and saved as a transparent PNG; the server reads the image itself and
 * keeps it private to the account. A drawn image is not a legally binding electronic signature, and the page says so.
 */
export function SignaturePad({ saved }: { saved: SavedSignature[] }) {
  const router = useRouter();
  const id = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const current = useRef<Stroke | null>(null);
  const [pen, setPen] = useState<number>(1);
  const [name, setName] = useState("");
  const [empty, setEmpty] = useState(true);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cssWidth, setCssWidth] = useState(600);

  useEffect(() => {
    const element = canvas.current;
    if (!element?.parentElement) return;
    const observer = new ResizeObserver(([entry]) => setCssWidth(Math.max(240, Math.floor(entry.contentRect.width))));
    observer.observe(element.parentElement);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (context) paint(context, strokes.current);
  }, [cssWidth]);

  const redraw = () => {
    const context = canvas.current?.getContext("2d");
    if (context) paint(context, strokes.current);
    setEmpty(strokes.current.length === 0);
  };

  function point(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function down(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    current.current = { width: PENS[pen].width, points: [point(event)] };
    strokes.current.push(current.current);
    setStatus("");
    redraw();
  }
  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!current.current) return;
    current.current.points.push(point(event));
    redraw();
  }
  function up() {
    current.current = null;
  }

  function undo() {
    strokes.current.pop();
    redraw();
  }
  function clear() {
    strokes.current = [];
    redraw();
  }

  function save() {
    const source = canvas.current;
    const context = source?.getContext("2d");
    if (!source || !context || strokes.current.length === 0) return;
    const bounds = inkBounds(context.getImageData(0, 0, source.width, source.height).data, source.width, source.height, 12);
    if (!bounds) return void setError("Draw a signature first.");
    const scale = Math.min(1, MAX_SIGNATURE_WIDTH / bounds.width);
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(bounds.width * scale));
    out.height = Math.max(1, Math.round(bounds.height * scale));
    out.getContext("2d")?.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, out.width, out.height);
    setError(null);
    out.toBlob((blob) => {
      if (!blob) return void setError("Could not make the image.");
      const form = new FormData();
      form.set("file", new File([blob], "signature.png", { type: "image/png" }));
      form.set("name", name);
      startTransition(async () => {
        try {
          const response = await saveSignatureAction(form);
          if (!response.success) return void setError(response.error.message);
          strokes.current = [];
          redraw();
          setName("");
          setStatus("Saved.");
          router.refresh();
        } catch {
          setError("Could not reach the server. Try again.");
        }
      });
    }, "image/png");
  }

  function remove(target: SavedSignature) {
    if (!window.confirm(`Delete “${target.name}”? This cannot be undone.`)) return;
    setError(null);
    startTransition(async () => {
      try {
        const response = await deleteSignatureAction(target.id);
        if (!response.success) return void setError(response.error.message);
        setStatus("Deleted.");
        router.refresh();
      } catch {
        setError("Could not reach the server. Try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Draw a signature" className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-4">
        <div className="min-w-0">
          <canvas
            ref={canvas}
            width={cssWidth * SCALE}
            height={CSS_HEIGHT * SCALE}
            style={{ width: cssWidth, height: CSS_HEIGHT, touchAction: "none" }}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            aria-label="Signature drawing area. Draw with a mouse, a finger or a pen."
            role="img"
            data-testid="pad"
            className="block max-w-full cursor-crosshair rounded-lg border border-control bg-surface-subtle"
          />
        </div>
        <p className="text-xs text-text-muted">Draw with a mouse, a finger or a pen. This pad cannot be used from the keyboard alone.</p>
        <div className="flex flex-wrap items-end gap-3">
          <div role="group" aria-label="Pen" className="inline-flex gap-1 rounded-xl bg-surface-subtle p-1">
            {PENS.map((p, index) => (
              <button key={p.label} type="button" aria-pressed={pen === index} onClick={() => setPen(index)} className={`inline-flex min-h-11 items-center rounded-lg px-3 text-[13px] font-semibold sm:min-h-9 ${pen === index ? "bg-accent text-on-accent" : "text-text-muted hover:bg-surface-hover"}`}>{p.label}</button>
            ))}
          </div>
          <button type="button" onClick={undo} disabled={empty} className={BUTTON}>Undo</button>
          <button type="button" onClick={clear} disabled={empty} className={BUTTON}>Clear</button>
        </div>
        <div className="flex flex-col gap-1 sm:max-w-sm">
          <label htmlFor={`${id}-name`} className="text-[13px] font-semibold text-text">Name (optional)</label>
          <input id={`${id}-name`} value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="For forms" className="min-h-11 w-full min-w-0 rounded-lg border border-control bg-surface px-3 text-sm text-text focus:border-accent focus:outline-none" />
        </div>
        <div>
          <button type="button" onClick={save} disabled={empty || pending || saved.length >= MAX_SIGNATURES} className={`${BUTTON} bg-accent text-on-accent hover:bg-accent-hover`}>{pending ? "Saving…" : "Save signature"}</button>
        </div>
        {saved.length >= MAX_SIGNATURES && <p className="text-xs text-text-muted">You keep {MAX_SIGNATURES} signatures at most. Delete one to save another.</p>}
        <p role="status" className="text-[13px] text-text-muted empty:hidden">{status}</p>
        {error && <p role="alert" className="text-[13px] font-semibold text-danger">{error}</p>}
      </section>

      <section aria-label="Saved signatures" className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text">Saved ({saved.length})</h2>
        {saved.length === 0 ? (
          <p className="text-sm text-text-muted">Nothing saved yet.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {saved.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface p-3">
                <div className="flex h-28 items-center justify-center rounded-lg bg-white p-2">
                  {/* A private, same-origin image the owner drew; next/image would only add a resize step for it. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/signatures/${item.id}`} alt={`Signature: ${item.name}`} className="max-h-full max-w-full object-contain" />
                </div>
                <p className="truncate text-sm font-semibold text-text">{item.name}</p>
                <p className="text-xs text-text-muted">{item.width} × {item.height} px, transparent PNG</p>
                <div className="flex flex-wrap gap-2">
                  <a href={`/api/signatures/${item.id}?download=1`} className={BUTTON}>Download</a>
                  <button type="button" disabled={pending} onClick={() => remove(item)} className={`${BUTTON} border-danger text-danger hover:bg-danger-soft`}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-text-muted">A signature kept here is private to your account. It is an image you drew, for forms and assignments: it is not a legally binding electronic signature, which depends on your country and on the service that asks for it.</p>
    </div>
  );
}
