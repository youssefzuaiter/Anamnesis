"use client";

import { useId } from "react";

/**
 * "Apply changes to": only this occurrence (the default) or this and the later ones. Shown by the event and task forms
 * on an occurrence of a series that has later ones. What is copied is said in words, and so is what stays, because
 * the choice overwrites other rows. The radios are inside labels that are at least 44px tall.
 */
export function SeriesChoice({ later, copied }: { later: number; copied: string }) {
  const note = useId();
  const option = "flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-text";
  const radio = "size-4 shrink-0 accent-accent";
  return (
    <fieldset aria-describedby={note} className="flex flex-col rounded-lg border border-border-subtle px-3 pb-2.5 pt-1">
      <legend className="px-1 text-xs text-text-muted">Apply changes to</legend>
      <label className={option}>
        <input type="radio" name="applyTo" value="this" defaultChecked className={radio} />
        Only this occurrence
      </label>
      <label className={option}>
        <input type="radio" name="applyTo" value="future" className={radio} />
        {`This and ${later} later occurrence${later === 1 ? "" : "s"}`}
      </label>
      <p id={note} className="text-xs leading-5 text-text-faint">{copied}</p>
    </fieldset>
  );
}
