/**
 * How server failures reach the user. The point of going through `packages/api-client` is that a
 * server answer which no longer matches the shared zod schemas fails loudly: every
 * `ResponseParseError` is logged with the endpoint it came from and shown as a toast
 * (`onContractError`), at most once per endpoint every half minute.
 */
import { ApiError, ResponseParseError } from "@librephotos/api-client/core";

type Listener = (error: ResponseParseError) => void;

const listeners = new Set<Listener>();
const lastShown = new Map<string, number>();
const REPEAT_MS = 30_000;

/** Calls `listener` for each contract error worth a toast; returns the unsubscribe. */
export function onContractError(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Logs and announces `error` when it is a contract error; anything else is left to the caller. */
export function reportContractError(error: unknown): void {
  if (!(error instanceof ResponseParseError)) return;
  console.error(`[api-client] the answer of "${error.context}" breaks its schema: ${error.issues}`);
  const now = Date.now();
  if (now - (lastShown.get(error.context) ?? 0) < REPEAT_MS) return;
  lastShown.set(error.context, now);
  for (const listener of listeners) listener(error);
}

/** The text of a contract error's toast. */
export function contractErrorText(error: ResponseParseError): string {
  return `The server's answer to "${error.context}" doesn't match the LibrePhotos API this app speaks. Details are in the console.`;
}

/** A reported contract error, rethrown with a message short enough to show inline. */
export class ContractError extends Error {
  constructor(readonly parseError: ResponseParseError) {
    super(`unexpected answer to "${parseError.context}" (details in the console)`, { cause: parseError });
    this.name = "ContractError";
  }
}

/** Runs one server call; a contract error is reported on the way out (as a `ContractError`). */
export async function serverCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof ResponseParseError)) throw error;
    reportContractError(error);
    throw new ContractError(error);
  }
}

/** Whether `error` means "try again later" (no answer, a busy or failing server), not "this file". */
export function isTransient(error: unknown): boolean {
  if (error instanceof ApiError) return error.status >= 500 || error.status === 429 || error.status === 408 || error.status === 401;
  return error instanceof TypeError || error instanceof NotSignedIn;
}

/** A request made while no one is signed in. */
export class NotSignedIn extends Error {
  constructor() {
    super("not signed in");
    this.name = "NotSignedIn";
  }
}

/** One line for the user about a failed server call. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.serverMessage ? `HTTP ${error.status}: ${error.serverMessage}` : `HTTP ${error.status}`;
  if (error instanceof ResponseParseError) return `unexpected answer to "${error.context}"`;
  if (error instanceof ContractError) return error.message;
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "unknown error";
}
