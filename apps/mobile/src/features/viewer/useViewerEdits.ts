import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import {
  bigThumbnailUrl,
  endpoints,
  photoKeys,
  useApiClient,
  type GeocodeResult,
} from "@librephotos/api-client";
import { useDb } from "@/db/provider";
import { remotePhotoIdByHash, type ViewerSlide } from "@/db/queries/detail";
import { useOnlineSelectionActions } from "@/features/selection/useOnlineSelectionActions";
import { serverAddress } from "@/lib/apiClient";
import { tokenStorage } from "@/lib/tokenStorage";
import { useAuthStore } from "@/stores/auth";
import { useToastStore } from "@/stores/toasts";
import { runSync } from "@/sync/run";
import { getThumb, removeThumb } from "@/sync/thumbs";
import { shareMedia } from "./shareMedia";
import { toNaiveTimestamp } from "./timestamp";

export type RotateDirection = "left" | "right";

/**
 * The viewer's online-only actions (doc 07 §4): each is a direct api-client
 * call that the bar and sheets disable while offline, with the result as a
 * toast. Share of a phone copy is the exception: it needs no server at all.
 *
 * After a server-side edit the photo's details are re-read, and a sync pulls
 * the edited row into the mirror, so the timeline, the header and the sheet
 * catch up without waiting for the next scheduled pass.
 */
export function useViewerEdits() {
  const { t } = useTranslation();
  const client = useApiClient();
  const db = useDb();
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.userId);
  const pushToast = useToastStore((s) => s.push);
  const { saveToPhone, confirmDeletePermanently } = useOnlineSelectionActions();
  /** Image hash → version, for photos rotated here: their thumbnails are re-fetched. */
  const [thumbnailVersions, setThumbnailVersions] = useState<Readonly<Record<string, number>>>({});

  const refresh = useCallback(
    (hash: string) => {
      void queryClient.invalidateQueries({ queryKey: photoKeys.detail(hash) });
      if (userId != null) void runSync(db, { userId, reason: "manual" });
    },
    [queryClient, db, userId]
  );

  const share = useCallback(
    async (slide: ViewerSlide, filename: string | null) => {
      const target = slide.local_uri
        ? { kind: "local" as const, localId: slide.local_id, uri: slide.local_uri }
        : slide.image_hash
          ? { kind: "remote" as const, imageHash: slide.image_hash, filename }
          : null;
      if (!target) return;
      const accessToken = target.kind === "remote" ? await Promise.resolve(tokenStorage.getAccessToken()) : null;
      const result = await shareMedia({ target, serverAddress: serverAddress(), accessToken });
      if (result === "unavailable") pushToast({ level: "error", message: t("viewer.shareUnavailable") });
      else if (result === "failed") pushToast({ level: "error", message: t("viewer.shareFailed") });
    },
    [pushToast, t]
  );

  const saveToDevice = useCallback((hash: string) => saveToPhone([hash]), [saveToPhone]);

  const togglePublic = useCallback(
    async (hash: string, makePublic: boolean) => {
      try {
        await endpoints.setPhotosPublic(client, [hash], makePublic);
        if (makePublic) {
          await Clipboard.setStringAsync(bigThumbnailUrl(serverAddress(), hash));
          pushToast({ level: "info", message: t("sharing.linkCopied") });
        } else {
          pushToast({ level: "info", message: t("sharing.shareSuccess") });
        }
      } catch {
        pushToast({ level: "error", message: t("sharing.shareError") });
      }
    },
    [client, pushToast, t]
  );

  const rotate = useCallback(
    async (hash: string, direction: RotateDirection) => {
      try {
        // The server turns counter-clockwise for a positive angle (#2595).
        await endpoints.rotatePhoto(client, hash, direction === "left" ? 90 : -90);
      } catch {
        pushToast({ level: "error", message: t("viewer.rotateError") });
        return;
      }
      setThumbnailVersions((v) => ({ ...v, [hash]: Date.now() }));
      // The grid's prefetched copy shows the old turn: drop it, so the grid
      // falls back to the server until the next sync prefetches it again.
      const photoId = remotePhotoIdByHash(db, hash);
      const cached = photoId ? getThumb(db, photoId) : null;
      if (photoId && cached) {
        removeThumb(db, photoId);
        await FileSystem.deleteAsync(cached.file_path, { idempotent: true }).catch(() => undefined);
      }
      pushToast({ level: "info", message: t("viewer.rotated") });
      refresh(hash);
    },
    [client, db, pushToast, t, refresh]
  );

  const saveTimestamp = useCallback(
    async (hash: string, date: Date) => {
      try {
        await endpoints.setPhotoTimestamp(client, hash, toNaiveTimestamp(date));
        pushToast({ level: "info", message: t("viewer.timestampSaved") });
        refresh(hash);
      } catch {
        pushToast({ level: "error", message: t("viewer.timestampError") });
      }
    },
    [client, pushToast, t, refresh]
  );

  const setLocation = useCallback(
    async (hash: string, place: GeocodeResult) => {
      try {
        const res = await endpoints.updatePhoto(client, hash, { exif_gps_lat: place.lat, exif_gps_lon: place.lon });
        const named = res.geocoded !== false && res.geocode_status !== "no_place" && res.geocode_status !== "failed";
        pushToast({ level: "info", message: named ? t("viewer.locationSaved") : t("viewer.locationSavedNoPlace") });
        refresh(hash);
      } catch {
        pushToast({ level: "error", message: t("viewer.locationError") });
      }
    },
    [client, pushToast, t, refresh]
  );

  const removeLocation = useCallback(
    async (hash: string) => {
      try {
        await endpoints.updatePhoto(client, hash, { exif_gps_lat: null, exif_gps_lon: null });
        pushToast({ level: "info", message: t("viewer.locationRemoved") });
        refresh(hash);
      } catch {
        pushToast({ level: "error", message: t("viewer.locationError") });
      }
    },
    [client, pushToast, t, refresh]
  );

  return {
    thumbnailVersions,
    share,
    saveToDevice,
    togglePublic,
    rotate,
    saveTimestamp,
    setLocation,
    removeLocation,
    confirmDeletePermanently,
  };
}
