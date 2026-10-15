import type { BackendNotReady } from "@librephotos/api-client";
import { DOCUMENTATION_LINK } from "../../uiConstants";

/** Failures with a text of their own; any other reason code reads as `unknown`. */
const KNOWN_FAILURES = ["E001", "E002"] as const;
type FailureKind = (typeof KNOWN_FAILURES)[number] | "unknown";

/** Which text BackendStatusGate shows: one per startup phase, one per known failure. */
export type StatusScreen = "updating" | "starting" | "unreachable" | FailedScreen;
export type FailedScreen = `failed.${FailureKind}`;

export function isFailedScreen(screen: StatusScreen): screen is FailedScreen {
  return screen.startsWith("failed.");
}

function failureKind(reasonCode: string | null): FailureKind {
  return KNOWN_FAILURES.find(code => code === reasonCode) ?? "unknown";
}

export function statusScreen({ state, reasonCode }: BackendNotReady): StatusScreen {
  switch (state) {
    case "updating":
    case "starting":
    case "unreachable":
      return state;
    case "failed":
      return `failed.${failureKind(reasonCode)}`;
  }
}

/** After this long, the waiting screens add a hint for whoever runs the server. */
export const SLOW_AFTER_MS = 15 * 60 * 1000;

const UPGRADING_DOCS = `${DOCUMENTATION_LINK}/docs/installation/upgrading`;

/** The upgrade guide's section for a failure (the same ones the backend's E001/E002 hints name). */
const FAILURE_DOCS: Record<FailedScreen, string> = {
  "failed.E001": `${UPGRADING_DOCS}#old-releases`,
  "failed.E002": `${UPGRADING_DOCS}#downgrade`,
  "failed.unknown": `${UPGRADING_DOCS}#updating-screen`,
};

export function failureDocs(screen: FailedScreen): string {
  return FAILURE_DOCS[screen];
}

type SupportDetails = {
  readiness: BackendNotReady;
  version: string | null;
  /** The page's address (origin), so a helper knows which install it is. */
  address: string;
  /** When the details were copied, as an ISO timestamp. */
  time: string;
};

/**
 * The text Copy details puts on the clipboard, for a support question or an issue. In English on
 * purpose: it is read by whoever helps, not by the user, and it holds only what the anonymous 503
 * said (no paths, no exception text).
 */
export function supportDetails({ readiness, version, address, time }: SupportDetails): string {
  return [
    `LibrePhotos status: ${readiness.state}`,
    `Reason code: ${readiness.reasonCode ?? "none"}`,
    `Version: ${version ?? "unknown"}`,
    `Address: ${address}`,
    `Time: ${time}`,
  ].join("\n");
}
