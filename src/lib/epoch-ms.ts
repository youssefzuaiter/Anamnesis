import { z } from "zod";
import { TIME_WINDOW } from "@/lib/time-grid";

/** A time as the browser sends it for the hourly grid: whole epoch milliseconds inside the window the calendar accepts. */
export const epochMs = z.number().int().min(TIME_WINDOW.from).max(TIME_WINDOW.to);

export const NOT_A_TIME = "That is not a time the calendar can hold.";
