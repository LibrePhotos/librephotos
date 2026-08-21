import { TimelineScreen } from "@/features/timeline/TimelineScreen";

// Online timeline proof screen (merged remote + local-only timeline lands with
// the offline DB in a later phase).
export default function PhotosIndexRoute() {
  return <TimelineScreen />;
}
