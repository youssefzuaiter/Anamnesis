import { PasswordGenerator } from "@/components/password-generator";

export const metadata = { title: "Password generator · Anamnesis" };

export default function PasswordPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Password generator</h1>
        <p className="mt-1 text-sm text-text-muted">For the password of a locked note, or any other. Everything happens in this page.</p>
      </header>
      <PasswordGenerator />
    </div>
  );
}
