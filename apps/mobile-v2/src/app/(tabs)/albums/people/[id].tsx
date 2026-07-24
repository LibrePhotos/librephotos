import { useLocalSearchParams } from "expo-router";
import { StubScreen } from "@/components/StubScreen";

export default function PeopleAlbumRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <StubScreen title="People album" note={`Album id: ${id}`} />;
}
