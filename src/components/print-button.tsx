"use client";

/**
 * Opens the browser's print dialog, whose "Save as PDF" is the export. The page's
 * own print rules (see the print block in globals.css) hide everything but the note.
 */
export function PrintButton({
  label = "Print or save as PDF",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={
        className ??
        "inline-flex shrink-0 items-center font-medium transition-colors hover:text-text print:hidden"
      }
    >
      {label}
    </button>
  );
}
