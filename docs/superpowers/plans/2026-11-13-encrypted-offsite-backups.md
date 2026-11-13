# Encrypted off-machine backups Implementation Plan

**Goal:** After each nightly backup, an encrypted copy lands in a folder the owner chooses (an external drive, a NAS mount, a synced folder), readable only with a private key that is not on this machine, and a restore from such a copy is tested.

**Architecture:** `age` (public-key mode). The host holds only the recipient (a public key) in `.env.production`; the private key lives with the owner. `ops/offsite.sh` tars each finished backup, encrypts it to a temp file in the destination, renames it into place, and prunes old copies with the existing retention policy (extended to `.tar.age` files). `ops/decrypt-backup.sh` and `ops/verify-offsite.sh` turn a copy back into a normal backup directory and prove it restores. Nothing is uploaded anywhere by this code: the destination is a path.

**Money:** none. A drive or any folder is free. Cloud storage is the paid part and is not built; an encrypted file is safe to put in any synced folder, and which service (free tier or paid) is the owner's call.

**Spec:** ROADMAP item 28: "Encrypted off-machine backups (S to M, ops, paid?). Encrypt first, then copy. An external drive is free; cloud storage costs money, so say so before building toward it."

## Global Constraints
- Owner chose `age` over gpg. age v1.3.2, installed by the owner with `brew install age`; CI installs the pinned release binary with its published sha256.
- The private key is never generated, read, stored or printed by any script run on the host. A value starting `AGE-SECRET-KEY` given as the recipient is refused without being echoed.
- A copy is written under a name no prune or restore treats as a copy (`.incomplete-`) and renamed in one step.
- An unmounted drive is a warning (exit 3), never a failure of the local backup.
- Decrypting never trusts the archive: names must be `anamnesis-<stamp>/...`, regular files and directories only, checked before anything is extracted.
- bash 3.2 and both BSD and GNU `tar`.

## Review Focus
1. A wrong or missing destination, a drive that is not plugged in, a half-written copy.
2. A forged copy: anyone who can write to the drive can encrypt to the public key (traversal names, symlinks, absolute paths).
3. A stale off-site copy going unnoticed (the weekly verify checks the age of the newest).
4. The wrong key, a damaged file, a pasted private key.
5. Retention deleting only what it made.

### Task 1: `retention.mjs` for `.tar.age` files plus `--newest-within`.
### Task 2: `ops/offsite.sh`, `lib.sh` settings, hook into `backup.sh` and `verify-backup.sh`.
### Task 3: `ops/decrypt-backup.sh`, `ops/verify-offsite.sh`.
### Task 4: CI installs age; rehearsal round trip; runbook and docs.
