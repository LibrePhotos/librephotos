import { useLocalSearchParams } from "expo-router";
import { PeopleScreen } from "@/features/albums/PeopleScreen";
import { PersonScreen } from "@/features/albums/PersonScreen";

/**
 * People: `all` shows the mirrored people grid (from SQLite); a person id opens
 * that person's page, whose photos are fetched online via api-client (faces are
 * not mirrored, doc 02).
 */
export default function PeopleAlbumRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (id === "all" || id === undefined) return <PeopleScreen />;
  return <PersonScreen id={Number(id)} />;
}
