/** The ERROR_REPORTING site setting (#2938): where new error reports go. */
export type ErrorReportingMode = "off" | "own_server" | "maintainers";
export type SendingMode = Exclude<ErrorReportingMode, "off">;

const MODES: readonly ErrorReportingMode[] = ["off", "own_server", "maintainers"];

/** The stored value as a mode; anything this app does not know counts as off. */
export function modeOf(value: string | undefined): ErrorReportingMode {
  return MODES.find(mode => mode === value) ?? "off";
}

/** The docs page that lists what a report holds. */
export const ERROR_REPORTING_DOCS = "/docs/user-guide/error-reporting";
