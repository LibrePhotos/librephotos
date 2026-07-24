import { useLocalSearchParams } from "expo-router";
import { StubScreen } from "@/components/StubScreen";

export default function UserAlbumRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <StubScreen title="User album" note={`Album id: ${id}`} />;
}
