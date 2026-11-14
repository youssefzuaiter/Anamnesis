import { config } from "zod";

/**
 * Runs in the browser before the app's code (Next's instrumentation-client convention).
 *
 * Zod's optimised parser checks once, when a schema is first built, whether the page may evaluate code. Under the
 * app's Content-Security-Policy (ROADMAP item 30) that check is itself a blocked `new Function`, which the browser
 * reports as a violation even though Zod catches the error. `jitless` takes the same path Zod takes when evaluation
 * is not allowed, so the check is skipped. Validation results are unchanged; only the speed-up is lost.
 */
config({ jitless: true });
