const MAX_CHUNK_CHARS = 1200;
export const MIN_CHUNK_CHARS = 40;

function splitOversizedBlock(block: string): string[] {
  const sentences = block.match(/[^.!?]+[.!?]*\s*/g) ?? [block];
  const parts: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current && current.length + sentence.length > MAX_CHUNK_CHARS) {
      parts.push(current.trim());
      current = "";
    }
    // A single sentence longer than the budget still has to be broken up.
    if (sentence.length > MAX_CHUNK_CHARS) {
      for (let i = 0; i < sentence.length; i += MAX_CHUNK_CHARS) {
        const part = sentence.slice(i, i + MAX_CHUNK_CHARS).trim();
        if (part) parts.push(part);
      }
      continue;
    }
    current += sentence;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

export function chunkText(text: string): string[] {
  const blocks = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const block of blocks) {
    if (block.length > MAX_CHUNK_CHARS) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(...splitOversizedBlock(block));
      continue;
    }

    if (current && current.length + block.length + 2 > MAX_CHUNK_CHARS) {
      chunks.push(current);
      current = block;
    } else {
      current = current ? `${current}\n\n${block}` : block;
    }
  }

  if (current) chunks.push(current);

  // Fragments this short carry no retrievable meaning and only add noise to ANN
  // results, but keep them if they are all the entity has.
  const meaningful = chunks.filter((chunk) => chunk.length >= MIN_CHUNK_CHARS);
  return meaningful.length > 0 ? meaningful : chunks;
}
