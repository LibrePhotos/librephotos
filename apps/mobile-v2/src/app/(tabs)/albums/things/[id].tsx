import { useLocalSearchParams } from "expo-router";
import { StubScreen } from "@/components/StubScreen";

export default function ThingsAlbumRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <StubScreen title="Things album" note={`Album id: ${id}`} />;
}
