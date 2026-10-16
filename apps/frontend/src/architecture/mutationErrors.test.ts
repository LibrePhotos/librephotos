/**
 * A failed save is reported once (#2222). The QueryClient's MutationCache toasts every failed
 * mutation that nobody else reports (`api_client/mutationErrors.ts`), but it cannot see an
 * `onError` passed to `mutate()`. So a component that reports a failure itself in a per-call
 * `onError` (a form error, a message in its dialog, its own toast) calls the hook with
 * `{ reportsErrors: true }`, or the user gets two messages for one failure.
 *
 * This test finds a file outside the API layer with an `onError:` that does not opt out that way.
 * LOCAL_ON_ERROR lists the ones whose `onError` only undoes local state, so the generic toast is
 * still the report; each says why.
 */
import { describe, expect, it } from "vitest";

const LOCAL_ON_ERROR = new Map<string, string>([
  ["/src/components/facedashboard/hooks/useFaceActions.ts", "undims the face it acted on; the toast reports"],
  ["/src/components/lightbox/CategoryBadge.tsx", "drops the optimistic badge; the hook reports"],
  ["/src/components/lightbox/usePhotoRotation.ts", "undoes the preview rotation; the toast reports"],
  [
    "/src/components/movephotos/MovePhotosModal.tsx",
    "opens the name clash dialog on a 409; the hook's own onError reports every other failure",
  ],
  ["/src/components/settings/useSaveSiteSettings.ts", "reloads the settings; the toast reports"],
  ["/src/hooks/useCopyPhotoToClipboard.ts", "its own useMutation onError, which the cache sees"],
]);

const PER_CALL_ON_ERROR = /\bonError:/;
const OPTS_OUT = /reportsErrors: true/;

function reportsTwice(source: string): boolean {
  return PER_CALL_ON_ERROR.test(source) && !OPTS_OUT.test(source);
}

const sources = import.meta.glob<string>(
  ["/src/**/*.{ts,tsx}", "!/src/**/*.test.{ts,tsx}", "!/src/**/*.test-utils.{ts,tsx}", "!/src/api_client/**"],
  { query: "?raw", import: "default", eager: true }
);

describe("mutation failures", () => {
  it("are reported once: a caller with its own onError opts out of the generic toast", () => {
    const offenders = Object.entries(sources)
      .filter(([path, source]) => !LOCAL_ON_ERROR.has(path) && reportsTwice(source))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it("leave LOCAL_ON_ERROR once their onError is gone, renamed or deleted", () => {
    const stale = [...LOCAL_ON_ERROR.keys()].filter(path => {
      const source = sources[path];
      return source === undefined || !PER_CALL_ON_ERROR.test(source);
    });

    expect(stale).toEqual([]);
  });

  it("flags a per-call onError without the opt-out, and passes one with it", () => {
    const planted = `
      const rename = useRenameUserAlbumMutation();
      rename.mutate(request, { onError: error => setError(error) });`;
    expect(reportsTwice(planted)).toBe(true);
    expect(reportsTwice(planted.replace("Mutation()", "Mutation({ reportsErrors: true })"))).toBe(false);
    // An image's onError prop is not a mutation's
    expect(reportsTwice(`<img onError={() => setFailed(true)} />`)).toBe(false);
  });
});
