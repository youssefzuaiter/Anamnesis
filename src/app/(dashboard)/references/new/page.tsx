import Link from "next/link";
import { createReferenceAction } from "@/actions/references";
import { ReferenceForm } from "@/components/reference-form";

export const metadata = { title: "Add a reference · Anamnesis" };

export default function NewReferencePage() {
  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-5">
        <Link href="/references" className="text-sm text-text-muted transition-colors hover:text-text">
          ← References
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-text">Add a reference</h1>
      </header>
      <ReferenceForm action={createReferenceAction} submitLabel="Add reference" />
    </div>
  );
}
