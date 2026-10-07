// Whether captions run in-process (port of lp_ml's caption `Backend`
// selection): kept apart from inprocess.ts so route modules can ask without
// loading the captioner's code (it loads on the first caption).
import { modeFor } from "../runtime";

/** Set once the port passes its goldens; `auto` mode then uses it. */
export const IMPLEMENTED = true;

/** LP_ML_CAPTION (inprocess | sidecar | auto). */
export const captionInProcess = () => modeFor("caption", IMPLEMENTED) === "inprocess";
