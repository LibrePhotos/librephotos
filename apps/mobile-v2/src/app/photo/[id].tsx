import { useLocalSearchParams } from "expo-router";
import { StubScreen } from "@/components/StubScreen";

// Full-screen photo viewer (modal). Full renditions, swiping, and actions land
// in the feature-parity phase; today it confirms the modal route + param.
export default function PhotoViewerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <StubScreen title="Photo viewer" note={`image_hash: ${id}`} />;
}
