import { ApiError } from "@librephotos/api-client";

/*
 * Whether a request found the backend down or still starting (#2310). Every request reports its
 * failure here (api.ts); BackendStatusGate listens and asks the readiness probe what is going on.
 * A plain module store rather than React state: the transport runs outside React.
 */

/**
 * True for a backend that is down or still starting: the request never got an answer (fetch rejects
 * with a TypeError), or the proxy or the startup placeholder answered for it (502-504). Wrong
 * credentials (401) and a 500 are reported in api.ts.
 */
export function isBackendUnreachable(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }
  return error instanceof ApiError && error.status >= 502 && error.status <= 504;
}

/** When the first request since the backend last served failed to reach it (ms since the epoch). */
let troubleSince: number | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach(listener => listener());
}

/** Called with every failed request; only the first unreachable one since the last recovery counts. */
export function reportRequestFailure(error: unknown): void {
  if (troubleSince !== null || !isBackendUnreachable(error)) {
    return;
  }
  troubleSince = Date.now();
  emit();
}

/** The backend serves again (or never stopped: a lone 504 from a slow request). */
export function clearBackendTrouble(): void {
  if (troubleSince === null) {
    return;
  }
  troubleSince = null;
  emit();
}

export function subscribeBackendTrouble(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function backendTroubleSince(): number | null {
  return troubleSince;
}
