import { useLocalSearchParams } from "expo-router";
import { FolderScreen, ROOT_FOLDER_ID } from "@/features/albums/FolderScreen";

/**
 * Folders: `root` is the scan directory, any other id a folder's server path.
 * There is no mirror table for the on-disk directory tree (it is a server-side
 * walk), so the browser is online-only by construction.
 */
export default function FoldersAlbumRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <FolderScreen id={id ?? ROOT_FOLDER_ID} />;
}
