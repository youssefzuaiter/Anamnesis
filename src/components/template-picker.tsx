import type { NoteTemplate } from "@/lib/note-templates";

type TemplatePickerProps = {
  templates: readonly NoteTemplate[];
  selectedId: string;
  /** Name of the template waiting for an answer, or null when nothing is being asked. */
  pendingName: string | null;
  onPick: (id: string) => void;
  onReplace: () => void;
  onKeep: () => void;
};

/**
 * A filled check for the chosen template and an empty ring for the others. They
 * are the same size, so choosing one never shifts the row, and the difference
 * does not rest on colour alone.
 */
export function Mark({ checked }: { checked: boolean }) {
  return checked ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <path
        className="stroke-accent-soft"
        d="M7.5 12.5l3 3 6-7"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/**
 * The "Start from" chips on New note, and the question asked before a template
 * would replace text the person wrote. Presentational: the editor owns the
 * state and decides what a choice does.
 */
export function TemplatePicker({
  templates,
  selectedId,
  pendingName,
  onPick,
  onReplace,
  onKeep,
}: TemplatePickerProps) {
  const selected = templates.find((template) => template.id === selectedId);

  return (
    <section className="flex flex-col gap-2.5">
      <span id="template-label" className="text-xs font-semibold text-text-muted">
        Start from
      </span>

      <div role="group" aria-labelledby="template-label" className="flex flex-wrap gap-2">
        {templates.map((template) => {
          const isSelected = template.id === selectedId;
          return (
            <button
              key={template.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onPick(template.id)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-lg border-[1.5px] px-4 text-sm font-semibold transition-colors ${
                isSelected
                  ? "border-accent bg-accent-soft text-accent-ink"
                  : "border-control bg-surface text-text hover:bg-surface-subtle"
              }`}
            >
              <Mark checked={isSelected} />
              {template.name}
            </button>
          );
        })}
      </div>

      <p className="text-[13.5px] leading-normal text-text-muted">{selected?.description}</p>

      {pendingName !== null && (
        <div
          role="group"
          aria-labelledby="replace-title"
          className="flex flex-col gap-3 rounded-xl border border-border-strong bg-surface p-4 shadow-card"
        >
          <div className="flex flex-col gap-1">
            <span id="replace-title" className="text-sm font-bold text-text">
              Replace what you have written?
            </span>
            <span className="text-[13.5px] leading-normal text-text-muted">
              Choosing {pendingName} swaps the text below for its outline. Your own
              title and tags are kept.
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onReplace}
              className="inline-flex min-h-11 items-center rounded-lg border-[1.5px] border-text bg-surface px-4 text-sm font-bold text-text transition-colors hover:bg-surface-subtle"
            >
              Replace text
            </button>
            {/* The safe choice takes focus when the question appears. */}
            <button
              type="button"
              autoFocus
              onClick={onKeep}
              className="inline-flex min-h-11 items-center rounded-lg border-[1.5px] border-control bg-surface px-4 text-sm font-semibold text-text-muted transition-colors hover:bg-surface-subtle"
            >
              Keep my text
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
