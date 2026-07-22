import { useEffect, useMemo, useState } from "react";
import type { People } from "../api_client/albums/hooks/useFetchPeopleAlbumsQuery";
import {
  getRecentlyTaggedPeopleIds,
  resolveRecentlyTaggedPeople,
  subscribeToRecentlyTaggedPeople,
} from "../util/recentlyTaggedPeople";

// The people the user tagged most recently, most recent first. The list is fed
// by useSetFacesPersonLabelMutation, so it picks up every tagging path in the
// app, not just the ones that happen next to this hook.
export function useRecentlyTaggedPeople(people: People | undefined): People {
  const [ids, setIds] = useState(getRecentlyTaggedPeopleIds);

  useEffect(() => subscribeToRecentlyTaggedPeople(() => setIds(getRecentlyTaggedPeopleIds())), []);

  return useMemo(() => resolveRecentlyTaggedPeople(ids, people), [ids, people]);
}
