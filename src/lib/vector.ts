import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { embedDocuments, assertValidEmbedding } from "@/lib/ollama";
import { chunkText } from "@/lib/chunking";
import { AppError } from "@/lib/api-response";

export const EMBEDDABLE_SOURCE_TYPES = [
  "note",
  "task",
  "event",
  "project",
  "course",
  "goal",
] as const;

export type EmbeddableSourceType = (typeof EMBEDDABLE_SOURCE_TYPES)[number];

export type VectorSearchResult = {
  id: string;
  sourceType: EmbeddableSourceType;
  sourceId: string;
  contentChunk: string;
  similarity: number;
};

const MAX_SEARCH_LIMIT = 50;

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export async function deleteEntityEmbeddings(
  userId: string,
  sourceType: EmbeddableSourceType,
  sourceId: string,
): Promise<void> {
  await prisma.workspaceEmbedding.deleteMany({
    where: { userId, sourceType, sourceId },
  });
}

/**
 * Replaces every stored chunk for one entity. Callers pass the entity's full
 * current text; re-indexing is delete-then-insert so stale chunks from removed
 * paragraphs cannot linger in search results.
 */
export async function indexEntity(
  userId: string,
  sourceType: EmbeddableSourceType,
  sourceId: string,
  text: string,
): Promise<number> {
  const chunks = chunkText(text);

  if (chunks.length === 0) {
    await deleteEntityEmbeddings(userId, sourceType, sourceId);
    return 0;
  }

  const embeddings = await embedDocuments(chunks);

  await prisma.$transaction(async (tx) => {
    await tx.workspaceEmbedding.deleteMany({
      where: { userId, sourceType, sourceId },
    });

    for (const [index, chunk] of chunks.entries()) {
      await tx.$executeRaw`
        INSERT INTO "WorkspaceEmbedding"
          ("id", "userId", "sourceType", "sourceId", "contentChunk", "embedding")
        VALUES (
          ${randomUUID()},
          ${userId},
          ${sourceType},
          ${sourceId},
          ${chunk},
          ${toVectorLiteral(embeddings[index])}::vector
        )`;
    }
  });

  return chunks.length;
}

export async function searchWorkspaceVectors(
  userId: string,
  queryEmbedding: number[],
  limit = 8,
  sourceTypes?: EmbeddableSourceType[],
): Promise<VectorSearchResult[]> {
  assertValidEmbedding(queryEmbedding);

  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), MAX_SEARCH_LIMIT);
  const vector = toVectorLiteral(queryEmbedding);
  const typeFilter =
    sourceTypes && sourceTypes.length > 0 ? sourceTypes : EMBEDDABLE_SOURCE_TYPES.slice();

  try {
    return await prisma.$queryRaw<VectorSearchResult[]>`
      SELECT
        "id",
        "sourceType",
        "sourceId",
        "contentChunk",
        1 - ("embedding" <=> ${vector}::vector) AS "similarity"
      FROM "WorkspaceEmbedding"
      WHERE "userId" = ${userId}
        AND "embedding" IS NOT NULL
        AND "sourceType" = ANY(${typeFilter}::text[])
      ORDER BY "embedding" <=> ${vector}::vector ASC
      LIMIT ${safeLimit}`;
  } catch (error) {
    throw new AppError(
      "VECTOR_SEARCH_FAILED",
      "Workspace vector search failed.",
      error,
    );
  }
}

export type SimilarEntity = {
  sourceType: EmbeddableSourceType;
  sourceId: string;
  similarity: number;
};

/**
 * Entities whose chunks sit closest to any chunk of `sourceId`, as a self-join
 * inside pgvector.
 *
 * Deliberately not "re-embed the note and search": the vectors are already
 * stored, so this needs no model call at all — related notes keep working with
 * Ollama switched off, unlike every other semantic path in the app. A note is
 * scored by its single best-matching chunk rather than an average, so one
 * strongly related paragraph in a long note still surfaces it.
 */
export async function findSimilarEntities(
  userId: string,
  sourceType: EmbeddableSourceType,
  sourceId: string,
  limit = 5,
  targetTypes?: EmbeddableSourceType[],
): Promise<SimilarEntity[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), MAX_SEARCH_LIMIT);
  const typeFilter =
    targetTypes && targetTypes.length > 0 ? targetTypes : EMBEDDABLE_SOURCE_TYPES.slice();

  try {
    return await prisma.$queryRaw<SimilarEntity[]>`
      SELECT
        other."sourceType",
        other."sourceId",
        MAX(1 - (other."embedding" <=> mine."embedding")) AS "similarity"
      FROM "WorkspaceEmbedding" mine
      JOIN "WorkspaceEmbedding" other
        ON other."userId" = mine."userId"
       AND other."embedding" IS NOT NULL
       AND other."sourceType" = ANY(${typeFilter}::text[])
       AND NOT (other."sourceType" = mine."sourceType" AND other."sourceId" = mine."sourceId")
      WHERE mine."userId" = ${userId}
        AND mine."sourceType" = ${sourceType}
        AND mine."sourceId" = ${sourceId}
        AND mine."embedding" IS NOT NULL
      GROUP BY other."sourceType", other."sourceId"
      ORDER BY "similarity" DESC
      LIMIT ${safeLimit}`;
  } catch (error) {
    throw new AppError(
      "VECTOR_SEARCH_FAILED",
      "Finding related items failed.",
      error,
    );
  }
}
