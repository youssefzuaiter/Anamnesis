# Two-factor sign-in (TOTP) Implementation Plan

**Goal:** An account can require a 6-digit authenticator code at sign-in, with one-time recovery codes, and a login failure stays indistinguishable from an unknown account.

**Architecture:** RFC 6238 TOTP written with `node:crypto` (no dependency for the algorithm); the secret is encrypted at rest (AES-256-GCM, key derived from `NEXTAUTH_SECRET`). The code is a third, optional field of the same login form, checked inside the Credentials `authorize` after the password, so every failure is the same `null`. Recovery codes are random 80-bit values, stored as SHA-256 hashes, each usable once. Setup shows a QR drawn by `qrcode-generator` (zero dependencies, MIT) plus the key as text.

**Spec:** ROADMAP item 26: "Two-factor sign-in (TOTP) (M, security, migration). Recovery codes; keep login failures indistinguishable from unknown accounts."

## Global Constraints
- Migration is additive (nullable columns, one new table): the previous release keeps working.
- Code: 6 digits, 30 s step, SHA-1 (what authenticator apps implement), window of one step either side; a step is accepted once (`totpLastStep`, updated atomically).
- Recovery: 10 codes, shown once, hashed, single use, regenerating replaces all.
- Turning off, and regenerating codes, need the password and a current code or a recovery code.
- Failed codes count in the same per-email limiter as passwords.
- Never in the export; never logged; `passwordHash`-level secrecy.

## Review Focus
1. Enumeration: unknown email, wrong password, right password with no/wrong code, all the same message; timing of unknown vs known.
2. Replay of a code within its window; replay of a recovery code; two concurrent uses.
3. A half-finished setup must not lock the account out (secret stored but not enabled).
4. Rotating `NEXTAUTH_SECRET` makes the stored secret undecryptable: recovery codes must still work, and the failure must be a refusal, not a crash.
5. Clock skew and the step boundary.

### Task 1: `lib/totp.ts`, `lib/secret-box.ts`, `lib/recovery-codes.ts` (pure)
RFC 6238 vectors, base32 round trip, window and replay rule, otpauth URI, encrypt/decrypt round trip and tamper refusal, recovery code format/normalise/hash.
### Task 2: schema, migration, `services/two-factor-service.ts`
`beginSetup`, `confirmSetup`, `checkSecondFactor`, `disable`, `regenerateRecoveryCodes`; integration tests incl. cross-account and races.
### Task 3: sign-in
`authorize` takes `code`; `loginAction` passes it; the form shows an always-present optional field.
### Task 4: settings card, actions, e2e, export shape, docs.
