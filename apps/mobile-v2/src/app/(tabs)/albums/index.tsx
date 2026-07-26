import { ExploreScreen } from "@/features/albums/ExploreScreen";

/**
 * Albums hub — the "Explore" screen. One section per category (My Albums,
 * People, Things, Tags, Places, Auto Created Albums, Folders), each linking to
 * the existing category routes (`/albums/people/all`, `/albums/user/all`, …).
 */
export default function AlbumsHubRoute() {
  return <ExploreScreen />;
}
