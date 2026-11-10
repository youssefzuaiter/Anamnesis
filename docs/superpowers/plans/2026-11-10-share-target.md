# Share to Anamnesis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Share a page from a phone (or another app) into Anamnesis: the clip card opens with the link filled in, and one tap clips it.

**Architecture:** One GET address, `/share?url=&text=&title=`, outside the dashboard layout. It only redirects: signed in to `/notes/import?url=<link>`, signed out to `/login?next=<that>`, and sign-in returns to a safe local `next`. The import page prefills the clip card from `?url=`. The web app manifest declares `/share` as a GET `share_target` (Android, desktop Chrome); on an iPhone an iOS Shortcut in the share sheet opens the same address.

**Tech Stack:** Next.js route handler and searchParams, Auth.js `auth()`, the existing clip action. No dependency, no migration.

**Spec:** `ROADMAP.md` item 21: "Share a page from a phone into Anamnesis. Needs HTTPS." Owner's rulings (2026-11-10): iPhone Safari has no Web Share Target (WebKit bug 194593, open, unassigned, last comments May 2026), so the iPhone path is a Shortcut that opens the prefilled card (no token); the share target is still declared for Android and desktop; built and tested here first, checked on the iPhone with item 19's production step.

## Global Constraints

- A GET never fetches a page and never writes: the person taps Clip page (otherwise any site could make the server fetch on their behalf, and a link preview could clip).
- The link is the first http(s) URL in `url`, else in `text` (Android puts the address inside the shared text); trailing punctuation is trimmed; at most 2,000 characters; anything else is no link (the card opens empty).
- `next` after sign-in is accepted only as a local path: starts with one `/`, not `//` or `/\`, no control characters, at most 2,500 characters; anything else goes to `/`.
- Only plain string parameters count; repeated parameters (arrays) are ignored.

## Review Focus

1. Open redirect through `next` (`//evil.example`, `/\evil`, `https:`, encoded forms, tabs and newlines).
2. A shared text with several links, with punctuation after the link, with no link, or very long.
3. Signed out: the link survives sign-in.
4. Nothing is fetched or created by opening `/share` or the prefilled card.
5. The phone layout of the prefilled card.

---

### Task 1: `lib/share.ts` (pure)
`sharedLink(params: { url?: unknown; text?: unknown }): string | null`, `safeNext(raw: unknown): string | null`, `shareTarget(link: string | null): string` (the import address). Unit tests for each rule above.

### Task 2: `/share` route, `next` on sign-in, prefilled card, manifest
`src/app/share/route.ts` (GET); login page passes a safe `next` to `AuthForm`, which replaces to it; `/notes/import` reads `url` and gives `ClipForm` an initial value, focusing Clip page when prefilled; `manifest.ts` gains `share_target`. Browser tests: signed in `/share?text=…` lands on a prefilled card with nothing created; signed out the link survives sign-in; a hostile `next` lands on `/`; the manifest declares the target; the phone width.

### Task 3: Record
CLAUDE.md section, README (the Shortcut, in a person's words), `ops/README.md` (the Shortcut's exact steps with the Tailscale host), ROADMAP tick 21.
