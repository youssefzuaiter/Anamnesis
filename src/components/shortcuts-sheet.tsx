import type { Ref } from "react";
import { Icon } from "@/components/icons";
import {
  ANYWHERE_SHORTCUTS,
  GO_TO_PREFIX,
  GO_TO_SHORTCUTS,
} from "@/lib/shortcuts";

/** A key drawn as a key. Shared with the hint and the sidebar button. */
export const KEYCAP_CLASS =
  "inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-b-2 border-border-strong bg-surface-subtle px-1.5 font-mono text-xs font-semibold";

type ShortcutsSheetProps = {
  ref: Ref<HTMLDialogElement>;
  enabled: boolean;
  onToggle: () => void;
};

/**
 * The `?` cheat-sheet. A native <dialog>, like the phone's More sheet, so focus
 * trapping, Escape and the backdrop come from the browser. When the single-key
 * shortcuts are off, the go-to keys are drawn dashed and said to be off in
 * words, so the difference does not rest on colour.
 */
export function ShortcutsSheet({ ref, enabled, onToggle }: ShortcutsSheetProps) {
  const goToKey = `${KEYCAP_CLASS} ${enabled ? "text-text" : "border-dashed text-text-faint"}`;

  return (
    <dialog
      ref={ref}
      aria-labelledby="shortcuts-title"
      onClick={(event) => {
        // A click that lands on the <dialog> itself is on the backdrop.
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
      className="m-auto max-h-[calc(100dvh-1.5rem)] w-[min(52.5rem,calc(100%-1.5rem))] overflow-y-auto rounded-2xl border border-border-strong bg-surface p-0 text-text shadow-card backdrop:bg-black/55"
    >
      <div className="flex items-center justify-between border-b border-border-subtle py-3 pl-4 pr-3 sm:pl-6">
        <h2 id="shortcuts-title" className="text-lg font-semibold">
          Keyboard shortcuts
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={(event) => event.currentTarget.closest("dialog")?.close()}
          className="inline-flex size-11 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-subtle"
        >
          <Icon name="close" />
        </button>
      </div>

      <div className="grid gap-6 p-4 sm:grid-cols-[17.5rem_minmax(0,1fr)] sm:gap-8 sm:p-6">
        <section>
          <h3 className="mb-2 text-xs font-semibold text-text-muted">Anywhere</h3>
          <ul>
            {ANYWHERE_SHORTCUTS.map((shortcut) => (
              <li
                key={shortcut.label}
                className="flex min-h-10 items-center justify-between gap-3 text-sm sm:min-h-9"
              >
                <span>{shortcut.label}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {shortcut.keys.map((key) => (
                    <kbd key={key} className={`${KEYCAP_CLASS} text-text`}>
                      {key}
                    </kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs leading-normal text-text-muted">
            On Windows and Linux, use Ctrl instead of ⌘.
          </p>
        </section>

        <section>
          <h3 className="mb-1 text-xs font-semibold text-text-muted">Go to</h3>
          <p className="mb-2 text-[13px] text-text-muted">
            Press {GO_TO_PREFIX}, then a key.
          </p>
          {!enabled && (
            <p
              role="note"
              className="mb-2 rounded-lg border border-border-strong bg-surface-subtle px-3 py-2 text-[13px] leading-normal"
            >
              Off: these keys do nothing until you turn single-key shortcuts back on.
            </p>
          )}
          <ul className="sm:grid sm:grid-flow-col sm:grid-cols-2 sm:grid-rows-8 sm:gap-x-6">
            {GO_TO_SHORTCUTS.map((shortcut) => (
              <li
                key={shortcut.key}
                className={`flex min-h-10 items-center justify-between gap-3 text-sm sm:min-h-9 ${
                  enabled ? "text-text" : "text-text-muted"
                }`}
              >
                <span>{shortcut.label}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <kbd className={goToKey}>{GO_TO_PREFIX}</kbd>
                  <span className="text-xs text-text-faint">then</span>
                  <kbd className={goToKey}>{shortcut.key}</kbd>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-border-subtle py-3 pl-4 pr-2 sm:pl-6">
        <div className="min-w-0">
          <span id="single-key-label" className="block text-sm font-semibold">
            Single-key shortcuts
          </span>
          <span className="block text-[13px] leading-normal text-text-muted">
            Go to keys and ? pause while you type in a field. ⌘K and ⌘J always work.
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="min-w-7 text-right text-sm font-semibold">
            {enabled ? "On" : "Off"}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-labelledby="single-key-label"
            onClick={onToggle}
            className="inline-flex min-h-11 min-w-13 items-center justify-center"
          >
            <span
              className={`relative block h-6 w-11 rounded-full transition-colors ${
                enabled ? "bg-accent" : "bg-control"
              }`}
            >
              <span
                className={`absolute top-[3px] size-[18px] rounded-full transition-[left] ${
                  enabled ? "left-[23px] bg-on-accent" : "left-[3px] bg-surface"
                }`}
              />
            </span>
          </button>
        </div>
      </div>
    </dialog>
  );
}
