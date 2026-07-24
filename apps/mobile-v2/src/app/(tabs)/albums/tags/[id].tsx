import { useLocalSearchParams } from "expo-router";
import { StubScreen } from "@/components/StubScreen";

export default function TagsAlbumRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <StubScreen title="Tags album" note={`Album id: ${id}`} />;
}
