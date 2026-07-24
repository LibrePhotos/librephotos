import { PhotoViewerScreen } from "@/features/viewer/PhotoViewerScreen";

// Full-screen viewer (modal). Pages over the timeline context from the mirror;
// the detail sheet fetches photo detail cache-then-network. `id` = image hash.
export default function PhotoViewerRoute() {
  return <PhotoViewerScreen />;
}
