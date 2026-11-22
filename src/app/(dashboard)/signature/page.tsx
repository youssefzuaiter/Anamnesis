import { requireUserId } from "@/lib/session";
import { listSignatures } from "@/services/signature-service";
import { SignaturePad } from "@/components/signature-pad";

export const metadata = { title: "Signature · Anamnesis" };

export default async function SignaturePage() {
  const userId = await requireUserId();
  const rows = await listSignatures(userId);
  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Signature</h1>
        <p className="mt-1 text-sm text-text-muted">Draw a signature and keep it as a transparent PNG for forms and assignments.</p>
      </header>
      <SignaturePad saved={rows.map((row) => ({ id: row.id, name: row.name, width: row.width, height: row.height, createdAt: row.createdAt.toISOString() }))} />
    </div>
  );
}
