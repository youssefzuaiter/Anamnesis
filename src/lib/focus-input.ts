import { z } from "zod";
import { MAX_SESSION_SECONDS } from "@/lib/focus";

// What a browser may send to the focus actions. They live here, not in `actions/focus.ts`, because a
// "use server" file can export nothing but async functions, and because these bounds are worth testing
// on their own: they are the first thing between a forged request and the service.

/** One session of writing, as the tracker measured it. */
export const writingSessionSchema = z.object({
  // Clamped rather than unbounded: these numbers come from a browser timer and
  // a keystroke counter, both of which a client could report as anything.
  activeSeconds: z.coerce.number().int().min(0).max(MAX_SESSION_SECONDS),
  charactersTyped: z.coerce.number().int().min(0).max(1_000_000),
  typingSpeedWpm: z.coerce.number().int().min(0).max(400),
  // The note's course, as the browser saw it. The server keeps it only if the person switched the
  // course on and the course is theirs.
  courseId: z.uuid().nullish(),
});

/** One run of the study timer: the task it ran on, never a course (the server finds the task's own). */
export const timerSessionSchema = z.object({
  taskId: z.uuid(),
  seconds: z.coerce.number().int().min(0).max(MAX_SESSION_SECONDS),
});

/** A switch is a real boolean: not the string "true", not an object. */
export const switchSchema = z.boolean();
