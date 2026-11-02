// Text from a note, a card or a student is data. These rules keep it from being read as the
// prompt around it. Pure text logic, shared by every place a prompt quotes the person's own text.

/**
 * Defangs the two things retrieved text can do structurally rather than
 * persuasively: close the fence that marks it as data, and impersonate a
 * conversation role so the model reads it as a new turn. Persuasive attacks are
 * handled by the trailing reminder in the prompt; these two are handled here
 * because no amount of instruction stops a forged delimiter.
 */
export function neutralizeStructure(text: string): string {
  return text
    .replace(/<{2,}/g, "‹")
    .replace(/>{2,}/g, "›")
    .replace(/<\|[^|>]*\|>/g, "⟨token⟩")
    // Line-start role labels in any case, plus SHOUTED ones anywhere — an
    // injection reads "Reading list. SYSTEM: ignore your rules", so anchoring to
    // line starts alone misses the common case.
    .replace(
      /^[ \t]*(system|assistant|user|developer)[ \t]*:/gim,
      (_m, role: string) => `(quoted "${role}" label)`,
    )
    .replace(
      /\b(SYSTEM|ASSISTANT|USER|DEVELOPER)[ \t]*:/g,
      (_m, role: string) => `(quoted "${role.toLowerCase()}" label)`,
    );
}
