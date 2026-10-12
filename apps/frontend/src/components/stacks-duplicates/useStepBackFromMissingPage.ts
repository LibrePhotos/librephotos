import { ApiError } from "@librephotos/api-client";
import { useEffect } from "react";

/**
 * A page past the end answers 404 (backend `api/pagination.py`). That is where
 * a numbered list lands after the last groups of its last page are resolved or
 * deleted, so step back one page instead of showing an empty one.
 */
export function useStepBackFromMissingPage(page: number, setPage: (page: number) => void, error: unknown) {
  useEffect(() => {
    if (page > 1 && error instanceof ApiError && error.status === 404) {
      setPage(page - 1);
    }
  }, [page, setPage, error]);
}
