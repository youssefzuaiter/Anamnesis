# Security policy

Anamnesis is a single-user, self-hosted workspace. There is no hosted service and no one else's data in it.

## Reporting a problem

If you find a vulnerability, please report it privately through GitHub: **Security → Report a vulnerability** on this repository. Do not open a
public issue for it. Include what you did, what you expected and what happened; a failing request or a short script helps most.

## What is already in place

- Every query is scoped by the signed-in account, and ids from the browser are ownership-checked (see `CLAUDE.md`, "Security, threat modeling & guardrails").
- Dependabot security updates, secret scanning with push protection, the dependency review on pull requests and CodeQL code scanning are on.
- Releases are built by CI, promoted only after a person approves the `production` environment, and rolled back automatically if the smoke check fails
  (`ops/README.md`).

## Supported versions

Only the latest commit on `main`.
