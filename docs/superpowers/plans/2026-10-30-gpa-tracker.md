# GPA and CGPA tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Courses page, show a cumulative GPA, a GPA per term, and what average the open courses need to reach a target, from credits and the official final letter the person records per course.

**Architecture:** Pure arithmetic in `lib/gpa-scale.ts` and `lib/gpa.ts` (no React, no Prisma), run on the server for the page and in the browser for the what-if. Four additive nullable columns hold the data. A small service and two actions write it; the page and the course page read it. **A letter is never worked out from marks:** the person enters the official letter, because many universities curve.

**Tech Stack:** Next.js 16 server components and Server Actions, Prisma 7, Zod, Tailwind (Quiet Studio tokens). No new dependency.

**Spec:** ROADMAP item 8: "Credits per course, a scale, a target. Pure arithmetic in `lib/`, unit-tested." There is no written spec; the approved design is the Design artifact https://claude.ai/artifact/FLTjtaCHQCDfEocyAEq54B (desktop light and dark, phone light and dark, and the course page), and the decisions below, binding on this plan:

- **Council (run inline by me, so weaker than four independent voices): A, the official letter you enter.** Unanimous. Option B (percent thresholds per letter, GPA derived from assessments) was rejected: a curved grade is not a function of the percentage, so B shows a confident wrong number, and it needs roughly double the schema, UI and tests. The Skeptic's change to the question: "a scale" is only a letter-to-points table.
- **Where:** a GPA card at the top of `/courses` (between the header and the add-course form), a credits chip and a letter badge on each course card, and a "Credits and final grade" card on the course page after its summary strip. No new sidebar item (a unit test requires every sidebar item to have a shortcut key).
- **Which courses count (exact rules).** A live course with credits missing or 0: **not counted**, reason `credits-missing`. Else with no final letter: **open** (it is part of the open credits). Else with a letter in the scale: **counted**. Else: **not counted**, reason `letter-not-in-scale`.
- **Two gaps in the approved mock, ruled here:** (1) the mock's Final grade control lists only scale letters, so a pass/fail letter such as `S` could not be entered and such a course would sit in the open credits forever; the control gets a last option **"Other letter…"** that reveals a short text field (1 to 4 characters). (2) The mock's reason text says to add the letter to the scale, but the scale editor only changes points; the reason reads "…is not in your letter scale, so it is left out." with nothing about adding it. Adding or removing letters is **not** built.
- **Persistence the mock did not show:** the target is saved when the select changes; the scale is edited as a draft that previews live, with **Save scale** and **Reset to preset** buttons (outlined, never the accent: the page's one accent button stays "Add course"). Expected letters are never saved.
- **The default expected letter** for an open course is the letter whose points are closest to the current CGPA (3.0 on a 4.0 scale when nothing is counted), ties to the higher letter.
- **The preset is a starting point.** It is a common Turkish scheme; I could not verify Bahçeşehir's exact table, and the UI says to check it against the transcript.

## Global Constraints

- No paid service, no new dependency. The migration is **additive and nullable only**; the previous release must keep working (CLAUDE.md "Operations"). Generate its SQL with `prisma migrate diff`, never `migrate dev`.
- Columns, exact: `Course.credits Float?`, `Course.finalGrade String?`, `UserProfile.targetGpa Float?`, `UserProfile.gpaScale Json?` (null means the preset).
- Preset `DEFAULT_GRADE_SCALE`, in this order: AA 4.0, BA 3.5, BB 3.0, CB 2.5, CC 2.0, DC 1.5, DD 1.0, FD 0.5, FF 0.0.
- Limits: credits `0 < credits <= 30` (0 or empty means "not set" and is stored as null); a letter is `/^[A-Z0-9+-]{1,4}$/` after trim and upper-casing; a scale has 1 to 20 distinct letters and points `0 <= p <= 10` rounded to 2 decimals; a target is `0 < t <= highest points in the scale`.
- Terms sort chronologically: `Season YYYY` with Spring < Summer < Fall within a year; any other label sorts after, alphabetically.
- Comparisons use an epsilon of `1e-9`; numbers are rounded to two decimals only for display (`formatGpa`, `—` for null).
- Every query is scoped by the session's `userId`; a client-supplied course id is ownership-checked by a scoped write; a soft-deleted course is never counted.
- Server Actions called from a client handler are dispatched one at a time, so the course controls send **absolute** values from local state, never deltas.
- Copy is exact (from the approved design): `Grade point average`, `Cumulative GPA`, `Target CGPA`, `Open courses · {n} · {R} credits`, `By term`, `Not counted · {n}`, `Edit the letter scale`, `Credits and final grade`, `These feed your GPA on the Courses page.`, `Not graded yet`, `Other letter…`, `Counted in your GPA.`, `Not counted yet.`, `Not counted: credits are not set.`. Status lines: needed `You need an average of {x} on the {R} open credits.` + `That is between {L} and {U}.` (or `exactly {U}`, or `{U} or better`) + ` Your expected letters give {y}.`; achieved `You are already at or above {T}.` + `Even a straight {lowest letter} on the {R} open credits would leave you at {w}.`; out of reach `{T} is out of reach with the open credits.` + `A straight {top letter} on all {R} of them gives {b}, which is {s} short.`. Helper lines: `Expected letters are only for this what-if and are not saved. Marks so far are shown for reference and never turned into a letter.`; `This is a starting point. Check it against your university's own table before trusting the numbers. A letter that is not listed here is not counted.`; `Enter the official letter once your university publishes it. A letter is never worked out from the marks below, because many universities curve the final grade.` Reasons: `Credits are not set.` / `Credits are not set, so it cannot be part of the open credits.` / `Its letter, {L}, is not in your letter scale, so it is left out.`
- Run heavy commands with `nice -n 19`, **except the Playwright suite**, which is flaky next to Ollama at that priority on this machine (CLAUDE.md "Link suggestions"): run it at normal priority, one worker. Playwright selects by label and by `main`.

## Review Focus

1. Another account's course id, a deleted course and a missing one are the same `RESOURCE_NOT_FOUND` and change nothing; another account's courses never enter the overview. (Task 3)
2. A letter outside the scale and credits that are missing are never silently counted as zero: each is listed with its reason, and an open course without credits is not part of the open credits. (Tasks 2 and 3)
3. Nothing counted, or no open credits, never produces `NaN` or `Infinity`: the CGPA is `—`, the needed-average result says so. (Task 2)
4. A malformed stored scale (not an array, duplicate letters, huge, bad points) falls back to the preset and never crashes the page; a bad scale is refused on write and nothing is stored. (Tasks 2 and 3)
5. Floating-point edges: half credits, a target exactly equal to a letter's points, a target exactly equal to the current worst or best case. (Task 2)
6. Rapid clicks on the credits stepper end on the right value, saved. (Task 4)
7. Soft-deleted courses are excluded from the cumulative GPA and from the open credits. (Task 3)
8. On a 375px phone every control is at least 44px and the page does not widen; light and dark both read. (Task 4)
9. The old release works against the new columns. (Task 1; the CI `container` job rehearses it.)

---

### Task 1: The columns

**Files:**
- Modify: `prisma/schema.prisma` (Course, UserProfile)
- Create: `prisma/migrations/20261030120000_gpa_tracker/migration.sql`
- Test: `tests/integration/gpa.test.ts` (created here, extended later)

**Interfaces:**
- Produces: `Course.credits: number | null`, `Course.finalGrade: string | null`, `UserProfile.targetGpa: number | null`, `UserProfile.gpaScale: JsonValue | null` on the generated client.

- [ ] **Step 1: Write the failing test** `tests/integration/gpa.test.ts` (header and per-test throwaway users like `tests/integration/link-suggestions.test.ts`): *the new columns exist and are optional*: a course made with only code, title and term has `credits === null` and `finalGrade === null`; updating it with `credits: 3.5, finalGrade: "BA"` reads back exactly; a profile upserted with `targetGpa: 3.5, gpaScale: [{letter:"AA",points:4}]` reads back; a fresh profile has `targetGpa === null` and `gpaScale === null`.
- [ ] **Step 2: Run to confirm failure.** Run: `nice -n 19 pnpm exec tsx --conditions=react-server --env-file=.env --test tests/integration/gpa.test.ts` — Expected: FAIL (unknown field or missing column).
- [ ] **Step 3: Implement** the four optional columns in the schema, then generate the migration SQL with `pnpm exec prisma migrate diff` from the live database to the schema (read `--help` for this Prisma's flags) into the migration folder; it must be four `ADD COLUMN` statements and nothing else (`Course`: `"credits" DOUBLE PRECISION`, `"finalGrade" TEXT`; `UserProfile`: `"gpaScale" JSONB`, `"targetGpa" DOUBLE PRECISION`). Apply with `pnpm exec prisma migrate deploy`, then `pnpm exec prisma generate`.
- [ ] **Step 4: Run to confirm pass,** then `pnpm exec tsc --noEmit` and `nice -n 19 pnpm test:integration`.
- [ ] **Step 5: Commit** the plan, the schema, the migration and the test ("Add the GPA columns").

---

### Task 2: The pure arithmetic

**Files:**
- Create: `src/lib/gpa-scale.ts`, `src/lib/gpa.ts`, `tests/unit/gpa-scale.test.ts`, `tests/unit/gpa.test.ts`

**Interfaces:**
- Produces, in `src/lib/gpa-scale.ts`:
  - `type GradeScale = { letter: string; points: number }[]` (kept sorted by points descending, ties by letter).
  - `DEFAULT_GRADE_SCALE: GradeScale`, `MAX_SCALE_ENTRIES = 20`, `MAX_POINTS = 10`.
  - `normaliseLetter(raw: string): string | null`.
  - `validateScale(input: unknown): { ok: true; scale: GradeScale } | { ok: false; message: string }` (strips extra keys, rounds points to 2 decimals, normalises letters, rejects duplicates after normalising).
  - `scaleOrDefault(stored: unknown): GradeScale`, `maxPoints(scale: GradeScale): number`.
- Produces, in `src/lib/gpa.ts`:
  - `type GpaCourse = { id: string; code: string; title: string; term: string; credits: number | null; finalGrade: string | null }`.
  - `summariseGpa(courses: GpaCourse[], scale: GradeScale): GpaSummary` where `GpaSummary = { credits: number; qualityPoints: number; cgpa: number | null; terms: { term: string; credits: number; gpa: number }[]; open: (GpaCourse & { credits: number })[]; openCredits: number; notCounted: { course: GpaCourse; reason: "credits-missing" | "letter-not-in-scale" }[] }`.
  - `projectCgpa(summary: GpaSummary, expected: Record<string, string>, scale: GradeScale): { cgpa: number | null; expectedAverage: number | null; credits: number }` (an open course without a valid expected letter is left out).
  - `neededAverage(summary: GpaSummary, target: number, scale: GradeScale): NeededAverage` where `NeededAverage` is `{ kind: "achieved"; worst: number } | { kind: "impossible"; best: number; short: number } | { kind: "needed"; points: number; lower: string | null; upper: string; exact: boolean } | { kind: "no-credits" }`.
  - `defaultExpectedLetter(scale: GradeScale, cgpa: number | null): string`.
  - `courseEffect(base: { credits: number; qualityPoints: number }, credits: number | null, letter: string | null, scale: GradeScale): CourseEffect` where `CourseEffect` is `{ kind: "counted"; qualityPoints: number; before: number | null; after: number } | { kind: "no-letter" } | { kind: "no-credits" } | { kind: "not-in-scale"; letter: string }`.
  - `courseBadges(course: GpaCourse, scale: GradeScale): { text: string; tone: "neutral" | "accent" | "warn" | "ok" }[]`.
  - `compareTerms(a: string, b: string): number`, `formatGpa(value: number | null): string`.

Behaviour the signatures do not fix: `neededAverage` computes `worst = qualityPoints / (credits + openCredits)` and `best = (qualityPoints + openCredits * maxPoints) / (credits + openCredits)`; `achieved` when `worst >= target - 1e-9`, else `impossible` when `best < target - 1e-9` (`short = target - best`), else `needed` with `points = (target * total - qualityPoints) / openCredits`, `upper` the lowest letter with points `>=` it, `lower` the highest letter strictly below it (null if none), `exact` when `upper` equals it within `1e-9`; `no-credits` when the total credits are 0. `courseBadges`: no credits → `Credits not set` (warn); else with no letter → `{n} credits` (neutral) + `In progress` (accent); else a letter in the scale → `{n} credits` + `{L} · {points to one decimal}` (ok); else `{n} credits` + `{L} is not in your scale` (warn). A credit count of 1 reads `1 credit`.

- [ ] **Step 1: Write the failing tests.** `tests/unit/gpa-scale.test.ts` (node:test): the preset is the nine letters in order, descending; `normaliseLetter(" ba ")` is `"BA"`, `"b+"` is `"B+"`, and `""`, `"ABCDE"`, `"A B"`, `"é"` are null; `validateScale` accepts the preset and a one-entry scale, sorts by points descending, rounds `3.456` to `3.46`, strips unknown keys, and rejects (with a message) a non-array, `[]`, 21 entries, duplicate letters (`"aa"` and `"AA"`), negative points, points above 10, `NaN`, `Infinity`, a string for points, an empty or invalid letter; `scaleOrDefault(null)`, `scaleOrDefault("garbage")` and `scaleOrDefault` of an invalid scale return the preset, and of a valid custom scale return it; `maxPoints` of the preset is 4.
  `tests/unit/gpa.test.ts`: the sample data from the design: eight counted courses (credits/letter: 4 AA, 4 BA, 3 BB, 3 CB in Fall 2025; 4 BA, 4 BB, 3 AA, 3 BA in Spring 2026) give credits 28, quality points 95, cgpa 95/28; terms in order Fall 2025 (14 credits, 46.5/14) then Spring 2026 (14, 48.5/14); a ninth course with letter `S` is `letter-not-in-scale`; credits `null`, `0` and a graded course without credits are `credits-missing`; a course with credits and `finalGrade` of `null`, `""` or `"  "` is open; a lowercase `"ba"` counts as BA; nothing counted gives `cgpa === null`, `terms` empty. `compareTerms`: Fall 2025 < Spring 2026 < Summer 2026 < Fall 2026, `"Year 1"` after all of them, two unknown labels alphabetical. `projectCgpa` with open courses (4, 4, 3 credits) expected BA, BA, BB: cgpa 132/39, expectedAverage 37/11, credits 39; a missing expected letter leaves that course out. `neededAverage` on the sample: target 3.5 is `needed`, points 41.5/11, lower `BA`, upper `AA`, not exact; target 3.0 is `needed`, points 2.0, upper `CC`, exact; target 2.0 is `achieved`; target 4.0 is `impossible` with `short` of 4 - 139/39; a target exactly equal to `95/39` is `achieved`; a target exactly equal to the best case `139/39` is `needed` with points 4 and `exact` true; with no open credits and cgpa 3.39, target 3.0 is `achieved` and target 3.5 is `impossible`; with nothing counted and no open credits it is `no-credits`; half credits (2.5 credits at BA with 3 credits at BB) give exact quality points 17.75 for the pair. `defaultExpectedLetter(preset, 3.39)` is `BA`, `(preset, 3.75)` is `AA` (tie goes high), `(preset, null)` is `BB`. `courseEffect` on base 28 credits and 95 points: 4 credits at BA is `counted` with before 95/28 and after 109/32; no letter is `no-letter`; `null` and 0 credits are `no-credits`; letter `S` is `not-in-scale`. `courseBadges` for each case above, in order, with exact text. `formatGpa(null)` is `—`, `formatGpa(3.3929)` is `3.39`.
- [ ] **Step 2: Run to confirm failure.** Run: `nice -n 19 pnpm exec tsx --conditions=react-server --test tests/unit/gpa-scale.test.ts tests/unit/gpa.test.ts` — Expected: FAIL, cannot find the modules.
- [ ] **Step 3: Implement** both modules to the interfaces above.
- [ ] **Step 4: Run to confirm pass,** then `nice -n 19 pnpm test` and `pnpm exec tsc --noEmit`. Mutation-check five rules, restoring after each (back up first and check the backup exists): an unset-credits course counted as 0 credits; the epsilon in `achieved` removed; a letter lookup that is case-sensitive; open credits including courses without credits; `scaleOrDefault` returning a malformed scale as is; each must fail a test.
- [ ] **Step 5: Commit** ("Add the GPA arithmetic").

---

### Task 3: Reading and writing it on the server

**Files:**
- Modify: `src/repositories/course-repository.ts`, `src/repositories/profile-repository.ts`
- Create: `src/services/gpa-service.ts`, `src/actions/gpa.ts`
- Test: `tests/integration/gpa.test.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - `courseRepository.setCourseGrade(userId: string, courseId: string, input: { credits: number | null; finalGrade: string | null }): Promise<boolean>` (`updateMany` scoped by `id`, `userId`, `deletedAt: null`; true when a row changed).
  - `profileRepository.getGpaSettings(userId): Promise<{ targetGpa: number | null; gpaScale: unknown }>` (upsert, like `getProfile`), `profileRepository.setTargetGpa(userId, target: number | null): Promise<void>`, `profileRepository.setGpaScale(userId, scale: GradeScale | null): Promise<void>` (null stores `Prisma.DbNull`).
  - `gpaService.getGpaOverview(userId): Promise<GpaOverview>` where `GpaOverview = { courses: GpaCourse[]; marks: Record<string, { average: number | null; remaining: number }>; scale: GradeScale; usesDefaultScale: boolean; targetGpa: number | null }` (live courses only; `marks` from `summarise()` in `lib/grades.ts`; `usesDefaultScale` is true when the stored scale is null or invalid).
  - `gpaService.setCourseGrade(userId, courseId, input: { credits: number | null; finalGrade: string | null }): Promise<void>` (validates and normalises, then the scoped write; `RESOURCE_NOT_FOUND` when no row changed).
  - `gpaService.setTargetGpa(userId, target: number | null): Promise<void>`, `gpaService.saveGradeScale(userId, scale: unknown | null): Promise<void>` (both `VALIDATION_ERROR` with the message from `validateScale` or "That target is outside your scale.").
  - `setCourseGradeAction(courseId: string, credits: number | null, finalGrade: string | null): Promise<ApiResponse<null>>`, `setTargetGpaAction(target: number | null): Promise<ApiResponse<null>>`, `saveGradeScaleAction(scale: GradeScale | null): Promise<ApiResponse<null>>` (`"use server"`; `requireUserId()` first, then Zod, then the service; `revalidatePath("/courses")` and, for the course action, `/courses/{id}`; `toApiResponse`).

- [ ] **Step 1: Write the failing integration tests** in `tests/integration/gpa.test.ts`, each with its own throwaway users: *setCourseGrade stores a normalised letter and credits*: `" ba "` is stored as `BA`; null clears both; `credits: 0` is stored as null; *validation*: credits `-1`, `31`, `NaN`, a letter of `"TOOLONG"` and `"A B"` are `VALIDATION_ERROR` and the row is unchanged; *another account's course, a soft-deleted course and a random id are `RESOURCE_NOT_FOUND`* and the other account's row is unchanged; *the overview holds only the caller's live courses* (a deleted one and the other account's are absent), carries `marks` from the assessments (`average` null before anything is scored, `remaining` the weight left), and reports the preset with `usesDefaultScale` true for a fresh account; *a malformed stored scale* (written directly: not an array, duplicate letters) gives the preset and `usesDefaultScale` true; *saveGradeScale* persists a valid custom scale and the overview returns it sorted with `usesDefaultScale` false, refuses a duplicate-letter scale with nothing stored, and `null` resets to the preset; *setTargetGpa* stores `3.5`, refuses `0`, `-1` and `4.5` (above the preset's top), and `null` clears it; *the profile row is created for an account that has none* (the throwaway users have no profile); *one account's settings never change another's*.
- [ ] **Step 2: Run to confirm failure.** Run: `nice -n 19 pnpm exec tsx --conditions=react-server --env-file=.env --test tests/integration/gpa.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the repository functions, the service and the actions, in the shape of `src/actions/courses.ts` and `src/services/course-service.ts`. (The Next 16 mutating-data and server-actions guides were read while planning: an action can be invoked from an event handler, and client dispatch is sequential.)
- [ ] **Step 4: Run to confirm pass,** then `nice -n 19 pnpm test:integration`, `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm lint`. Mutation-check five rules, restoring after each: drop `userId` from `setCourseGrade`; drop `deletedAt: null` from it; the overview not excluding deleted courses; an invalid scale stored anyway; `getGpaOverview` returning a malformed scale unvalidated; each must fail a test.
- [ ] **Step 5: Commit** ("Read and write grades and settings").

---

### Task 4: The Courses page, the course page and the browser tests

**Files:**
- Create: `src/components/gpa-card.tsx`, `src/components/course-grade.tsx`, `tests/e2e/gpa.spec.ts`
- Modify: `src/app/(dashboard)/courses/page.tsx`, `src/app/(dashboard)/courses/[id]/page.tsx`

**Interfaces:**
- Consumes: Tasks 2 and 3.
- Produces:
  - `GpaCard({ courses, marks, scale, usesDefaultScale, targetGpa }: GpaOverview)` (`"use client"`). Local state: `target`, `expected` (per open course, defaulting with `defaultExpectedLetter`), and a points draft of the scale. Everything shown is computed with `lib/gpa` from the draft, so it previews live. The target `<select>` offers 2.00, 2.50, 3.00, 3.25, 3.50, 3.75, 4.00 (plus a stored value not in the list) and calls `setTargetGpaAction` on change; the scale rows are `−`/`+` buttons of 0.1 (clamped 0 to 10) and, when the draft differs from the saved scale, a `Save scale` button (`saveGradeScaleAction(draft)`) and a line `Not saved yet`; `Reset to preset` appears when the saved or draft scale differs from the preset and saves null. Status in a `role="status"` region. Hidden when there are no courses. With courses but none counted, the cumulative value reads `—` with the line `Nothing counted yet. Give a course credits and a final grade.`; the "If {term} goes as expected" block reads `If {term} goes as expected` when every open course shares one term and `If your open courses go as expected` otherwise.
  - `CourseGrade({ courseId, credits, finalGrade, scale, base }: { courseId: string; credits: number | null; finalGrade: string | null; scale: GradeScale; base: { credits: number; qualityPoints: number } })` (`"use client"`): a credits stepper (`aria-label` `One credit fewer` / `One credit more`, clamped 0 to 30), the Final grade `<select>` (`Not graded yet`, each scale letter as `{L} · {points} points`, then `Other letter…` which reveals a text field of 1 to 4 characters that saves on blur or Enter; a stored letter outside the scale opens it prefilled), and the status block from `courseEffect`. State is local and leads; each change calls `setCourseGradeAction(courseId, credits || null, letter || null)` with the latest local values (kept in a ref so rapid clicks send absolute values); a failure shows its message in `role="alert"` and leaves the control as typed.
  - The page passes `base` computed with `summariseGpa` over every other course of the account.

- [ ] **Step 1: Write the failing e2e tests** `tests/e2e/gpa.spec.ts` (the `main(page)` helper; helpers `makeCourse(page, code, title)` through the add-course form, `setGrade(page, url, credits, letter)` through the course page controls, and `deleteCourse(page, url)` with the native confirm accepted; every test deletes its courses at the end so the shared account's GPA stays deterministic; other specs' courses have no credits and show only as "Not counted"): (1) *credits and a final letter count*: a 4-credit AA course and a 4-credit BB course give `3.50` and `8 credits counted`, the course page says `Counted in your GPA.` with `4 credits × 4.0 points = 16.0 quality points`, and the cards show `4 credits` and `AA · 4.0`; (2) *a target and an expected letter show what is needed*: with one 4-credit AA course and one open 4-credit course, target `3.75` reads `You need an average of 3.50 on the 4 open credits.` and `That is exactly BA.`, choosing expected `AA` for the open course makes the projected value `4.00`, and target `2.00` reads `You are already at or above 2.00.`; (3) *another letter is not counted, with the reason*: `Other letter…` then `S` on a 3-credit course lists it under `Not counted` with `Its letter, S, is not in your letter scale, so it is left out.` and leaves the cumulative GPA unchanged; (4) *a course with no credits is listed*: `Credits are not set.` and a `Set credits` link that opens the course; (5) *the scale is editable and saved*: with 4 credits AA and 4 credits BB, raising BB five times shows `3.75` live and `Not saved yet`, `Save scale` persists it across a reload, `Reset to preset` restores `3.50`; (6) *the target survives a reload*; (7) *four quick clicks on the credits stepper end at 4 and survive a reload*; (8) *phone, 375px, light and dark*: no horizontal overflow on `/courses` and on a course page, and the stepper, the selects, `Save scale`, the scale buttons and `Set credits` are each at least 44px tall.
- [ ] **Step 2: Run to confirm failure.** Run: `pnpm exec playwright test tests/e2e/gpa.spec.ts --reporter=line` — Expected: FAIL (the dev server on port 3100 is started by Playwright).
- [ ] **Step 3: Implement** the two components, the Courses page (GPA card above the add-course form; the credits chip and letter badge on each card from `courseBadges`, tones mapped to the existing tokens `surface-subtle`/`text-muted`, `accent-soft`/`accent-ink`, `warn-soft`/`warn`, `ok-soft`/`ok`) and the course page (the card after the summary strip and before Exam prep). Follow the look of the approved design and the patterns of `plan-day.tsx` and `exam-prep.tsx` (client component, `useTransition`, `role="status"` and `role="alert"`).
- [ ] **Step 4: Run to confirm pass,** then the whole Playwright suite at normal priority (`pnpm test:e2e`, one worker) — Expected: every new test passes and the existing ones are unchanged; if the known goals test fails on a slow task creation, rerun it alone and report it. Mutation-check four rules: the stepper sending a delta instead of the absolute value (the quick-click test must fail), the status block ignoring the draft scale (test 5), `Not counted` not listing a letter outside the scale (test 3), the `Save scale` handler not saving (test 5).
- [ ] **Step 5: Commit** ("Show the GPA on the Courses page and set credits and grades on a course").

---

### Task 5: Guard, check, record, ship

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `ROADMAP.md`

- [ ] **Step 1: Guard.** Run the `security-review` skill over the diff. What to check: every query and write carries `userId`; a foreign, deleted or missing course id is the same `RESOURCE_NOT_FOUND`; credits, letter, target and scale are validated on write and the stored scale again on read; the scale JSON has a size cap (20 entries, 4-character letters); no raw SQL; errors are static; nothing writes on a page load; measure, rather than read, any regular expression or loop that runs on user text (the lesson of item 7). Ledger the findings and fix real ones test-first.
- [ ] **Step 2: Simplify.** Run the `simplify` skill over `git diff <BASE>..HEAD -- src tests`, inline, behaviour-preserving.
- [ ] **Step 3: Check.** `tsc`, `pnpm lint`, `pnpm test`, `pnpm test:integration` with Ollama **off** (as CI's `checks`), `pnpm build`, then the whole Playwright suite at normal priority. Then look at it on a throwaway account (named with the `e2e` prefix, deleted afterwards; never run Playwright while it exists): `/courses` and a course page at desktop and 375px, light and dark, with real data: credits and letters set, a target, an expected letter, a letter outside the scale, a course without credits, the scale edited and saved.
- [ ] **Step 4: Review.** Read `requesting-code-review/code-reviewer.md` and review the whole branch yourself; ledger `Final review: self-review`; Critical and Important findings get a failing test first; Minor go to the ledger.
- [ ] **Step 5: Record.** `CLAUDE.md`: a section "GPA and CGPA" placed before "Trash and soft-delete recovery": the council decision and its cost, the counting rules, the two gaps in the mock and how they were ruled, the preset is unverified, what is persisted and what is not, the schema (additive; the previous release works), what testing and the review turned up, and what is **not done** (adding or removing letters on the scale; a carry-in CGPA for terms before the app; the assistant knowing the GPA; courses still missing from the JSON export, now with these columns; a graduation-credits count; a what-if saved across visits). `README.md`: the Courses bullet. `ROADMAP.md`: tick item 8.
- [ ] **Step 6: Ship.** Commit, push `gpa-tracker`, open a pull request against `main` (never a push to `main`) whose description lists what was verified and what was only read; report the checks once; do not poll CI.
