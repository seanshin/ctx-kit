/**
 * The check registry. Order here is the order reported.
 *
 * APPEND ONLY: work streams add their check file and one line below, so two
 * streams never edit the same statement (docs/plan-v2.md §8-B.4).
 */
import type { Check } from "./types.js";
import { rulesCheck } from "./rules.js";
import { syncCheck } from "./sync.js";
import { repomapCheck } from "./repomap.js";
import { secretsCheck } from "./secrets.js";

export const CHECKS: Check[] = [rulesCheck, syncCheck, repomapCheck, secretsCheck];

export type { Check, CheckContext, CheckOptions, CheckResult } from "./types.js";
