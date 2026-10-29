// The one line under a suggested note that says why it is offered. Pure text.

export type LinkReason = "similar" | "named";

const LABEL: Record<LinkReason, string> = {
  named: "Named in this note",
  similar: "Close in meaning",
};

export function reasonLine(reasons: LinkReason[], similarity: number | null): string {
  return reasons
    .map((reason) =>
      reason === "similar" && similarity !== null
        ? `${LABEL[reason]} · ${similarity.toFixed(2)}`
        : LABEL[reason],
    )
    .join(" · ");
}
