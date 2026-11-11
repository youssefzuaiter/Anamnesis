import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserId } from "@/lib/session";
import { AppError } from "@/lib/api-response";
import { getReference } from "@/services/reference-service";
import { updateReferenceAction } from "@/actions/references";
import { ReferenceForm } from "@/components/reference-form";

export const metadata = { title: "Edit reference · Anamnesis" };

export default async function EditReferencePage({ params }: PageProps<"/references/[id]/edit">) {
  const userId = await requireUserId();
  const { id } = await params;
  let reference;
  try {
    reference = await getReference(userId, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "RESOURCE_NOT_FOUND") notFound();
    throw error;
  }
  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-5">
        <Link href={`/references/${reference.id}`} className="text-sm text-text-muted transition-colors hover:text-text">
          ← {reference.title}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-text">Edit reference</h1>
        {reference.bibtex && (
          <p className="mt-1 text-sm text-text-muted">Saving replaces the imported BibTeX with what you see here.</p>
        )}
      </header>
      <ReferenceForm action={updateReferenceAction.bind(null, reference.id)} initial={reference} submitLabel="Save reference" />
    </div>
  );
}
