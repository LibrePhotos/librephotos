import { ApiError, ResponseParseError } from "@librephotos/api-client/core";

type Listener = (error: ResponseParseError) => void;

const listeners = new Set<Listener>();
const lastShown = new Map<string, number>();
const REPEAT_MS = 30_000;

export function onContractError(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function reportContractError(error: unknown): void {
  if (!(error instanceof ResponseParseError)) return;
  console.error(`[api-client] the answer of "${error.context}" breaks its schema: ${error.issues}`);
  const now = Date.now();
  if (now - (lastShown.get(error.context) ?? 0) < REPEAT_MS) return;
  lastShown.set(error.context, now);
  for (const listener of listeners) listener(error);
}

export function contractErrorText(error: ResponseParseError): string {
  return `The server's answer to "${error.context}" doesn't match the LibrePhotos API this app speaks. Details are in the console.`;
}

export class ContractError extends Error {
  constructor(readonly parseError: ResponseParseError) {
    super(`unexpected answer to "${parseError.context}" (details in the console)`, { cause: parseError });
    this.name = "ContractError";
  }
}

export async function serverCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof ResponseParseError)) throw error;
    reportContractError(error);
    throw new ContractError(error);
  }
}

export function isTransient(error: unknown): boolean {
  if (error instanceof ApiError) return error.status >= 500 || error.status === 429 || error.status === 408 || error.status === 401;
  return error instanceof TypeError || error instanceof NotSignedIn;
}

export class NotSignedIn extends Error {
  constructor() {
    super("not signed in");
    this.name = "NotSignedIn";
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.serverMessage ? `HTTP ${error.status}: ${error.serverMessage}` : `HTTP ${error.status}`;
  if (error instanceof ResponseParseError) return `unexpected answer to "${error.context}"`;
  if (error instanceof ContractError) return error.message;
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "unknown error";
}
