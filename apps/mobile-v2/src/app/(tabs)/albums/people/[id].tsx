import { useLocalSearchParams } from "expo-router";
import { PeopleScreen } from "@/features/albums/PeopleScreen";
import { StubScreen } from "@/components/StubScreen";

/**
 * People: `all` shows the mirrored people grid (from SQLite). A specific person
 * id opens their photos, which are fetched online via api-client (faces are not
 * mirrored, doc 02) — wired in a later phase.
 */
export default function PeopleAlbumRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (id === "all" || id === undefined) return <PeopleScreen />;
  return <StubScreen title="Person" note={`Person id: ${id} (online detail — later phase)`} />;
}
