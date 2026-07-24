import { useLocalSearchParams } from "expo-router";
import { StubScreen } from "@/components/StubScreen";

export default function FoldersAlbumRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <StubScreen title="Folders album" note={`Album id: ${id}`} />;
}
