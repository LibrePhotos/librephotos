import type { LibraryShare } from "@librephotos/api-client";
import { useLibrarySharesQuery } from "../../api_client/libraryShares/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";

/** My library shares (#2731), split into the ones I gave and the ones I received. */
export function useLibraryShares() {
  const query = useLibrarySharesQuery();
  const { data: self } = useCurrentUserSelfDetailsQuery();
  const shares: readonly LibraryShare[] = query.data ?? [];
  return {
    query,
    given: shares.filter(share => share.owner.id === self?.id),
    received: shares.filter(share => share.recipient.id === self?.id),
    loading: query.isLoading || self === undefined,
  };
}
