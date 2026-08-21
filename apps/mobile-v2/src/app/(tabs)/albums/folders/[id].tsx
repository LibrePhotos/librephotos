import { useTranslation } from "react-i18next";
import { useLocalSearchParams } from "expo-router";
import { StubScreen } from "@/components/StubScreen";
import { useOnlineStatus } from "@/hooks/use-online-status";

/**
 * Folders. There is no mirror table for the on-disk directory tree (it is a
 * server-side walk), so this route is online-only by construction — the Explore
 * hub says so on the Folders row, and this screen repeats it rather than
 * pretending to be empty. The browser itself lands in a later phase.
 */
export default function FoldersAlbumRoute() {
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();
  const { id } = useLocalSearchParams<{ id: string }>();
  void id;
  return (
    <StubScreen
      title={t("explore.folders")}
      note={isOnline ? t("explore.foldersOnline") : t("explore.foldersOffline")}
    />
  );
}
