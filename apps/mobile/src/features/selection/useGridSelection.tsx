import { useCallback, useMemo, useReducer, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useMutations } from "@/mutations/useMutations";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { SelectionActionBar, type SelectionExtraAction } from "@/components/SelectionActionBar";
import { AlbumPickerSheet } from "@/components/AlbumPickerSheet";
import { ShareSheet } from "@/features/sharing/ShareSheet";
import { useToastStore } from "@/stores/toasts";
import { useOnlineSelectionActions } from "./useOnlineSelectionActions";
import {
  emptySelection,
  isSelected as isSelectedSel,
  selectedDownloadableHashes,
  selectedImageHashes,
  selectedItems,
  selectedPhotoIds,
  selectionCount,
  selectionReducer,
  type SelectableItem,
} from "./reducer";

/**
 * Which boolean each flag action applies (a filter screen inverts its own).
 * `deleted: false` makes the grid the Trash: its trash action restores, and it
 * is the one grid that offers "Delete permanently".
 */
export type SelectionDirections = {
  favorite?: boolean;
  hidden?: boolean;
  deleted?: boolean;
  /** `false` makes the grid the Archive: its archive action unarchives. */
  archived?: boolean;
};

/**
 * A screen's own selection action: `run` gets the selected photos (UUIDs and
 * image hashes) and `done`, which ends selection mode (call it once the action
 * is confirmed or sent).
 */
export type GridExtraAction = Omit<SelectionExtraAction, "onPress"> & {
  run: (picked: { photoIds: string[]; imageHashes: string[] }, done: () => void) => void;
};

/**
 * Wires grid multi-select to the offline-mutation outbox. Owns the selection
 * reducer + the action bar + the add-to-album sheet, and returns the item
 * handlers a grid needs. Bulk actions dispatch through `useMutations` (optimistic
 * mirror write → outbox → replay) and then exit selection mode.
 */
export function useGridSelection(
  directions: SelectionDirections = {},
  /**
   * When set, the action bar gains "Remove from this album" and, with exactly
   * one photo selected, "Set as cover".
   */
  album?: { albumId: number; title: string },
  /** A screen's own actions for the bar's "More" sheet (a person page's "Remove from person"). */
  extraActions?: GridExtraAction[]
) {
  const { t } = useTranslation();
  const mutations = useMutations();
  const pushToast = useToastStore((s) => s.push);
  const online = useOnlineSelectionActions();
  const isOnline = useOnlineStatus();
  const [state, dispatch] = useReducer(selectionReducer, emptySelection);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareHashes, setShareHashes] = useState<string[]>([]);

  const dir = {
    favorite: directions.favorite ?? true,
    hidden: directions.hidden ?? true,
    deleted: directions.deleted ?? true,
    archived: directions.archived ?? true,
  };

  const enter = useCallback((item: SelectableItem) => dispatch({ type: "enter", item }), []);
  const toggle = useCallback((item: SelectableItem) => dispatch({ type: "toggle", item }), []);
  const toggleGroup = useCallback((items: SelectableItem[]) => dispatch({ type: "toggleGroup", items }), []);
  const clear = useCallback(() => dispatch({ type: "clear" }), []);

  const runFavorite = useCallback(() => {
    const hashes = selectedImageHashes(state);
    if (hashes.length) mutations.favorite(hashes, dir.favorite);
    clear();
  }, [state, mutations, dir.favorite, clear]);

  const runHide = useCallback(() => {
    const hashes = selectedImageHashes(state);
    if (hashes.length) mutations.hide(hashes, dir.hidden);
    clear();
  }, [state, mutations, dir.hidden, clear]);

  const runTrash = useCallback(() => {
    const hashes = selectedImageHashes(state);
    if (hashes.length) mutations.trash(hashes, dir.deleted);
    clear();
  }, [state, mutations, dir.deleted, clear]);

  const runArchive = useCallback(() => {
    const hashes = selectedImageHashes(state);
    if (hashes.length) mutations.archive(hashes, dir.archived);
    clear();
  }, [state, mutations, dir.archived, clear]);

  /** One `rating` outbox row per photo: the endpoint rates a single photo. */
  const runRate = useCallback(
    (rating: number) => {
      for (const hash of selectedImageHashes(state)) mutations.rate(hash, rating);
      clear();
    },
    [state, mutations, clear]
  );

  const coverPick = useMemo(() => {
    if (!album) return null;
    const items = selectedItems(state);
    const only = items.length === 1 ? items[0] : undefined;
    return only?.photoId && only.imageHash ? { photoId: only.photoId, imageHash: only.imageHash } : null;
  }, [album, state]);
  const runSetCover = useCallback(() => {
    if (!album || !coverPick) return;
    mutations.setAlbumCover(album.albumId, coverPick.photoId, coverPick.imageHash);
    pushToast({ level: "info", message: t("albumDetail.coverSet") });
    clear();
  }, [album, coverPick, mutations, pushToast, t, clear]);

  const onPickAlbum = useCallback(
    (album: { id: number; title: string }) => {
      const items = selectedItems(state);
      const photoIds = selectedPhotoIds(state);
      const imageHashes = selectedImageHashes(state);
      if (photoIds.length) mutations.addToAlbum(album.id, album.title, photoIds, imageHashes);
      void items;
      setPickerOpen(false);
      clear();
    },
    [state, mutations, clear]
  );

  const onCreateAlbum = useCallback(
    (title: string) => {
      const photoIds = selectedPhotoIds(state);
      mutations.createAlbum(title, photoIds);
      setPickerOpen(false);
      clear();
    },
    [state, mutations, clear]
  );

  const runRemoveFromAlbum = useCallback(() => {
    if (!album) return;
    const photoIds = selectedPhotoIds(state);
    const imageHashes = selectedImageHashes(state);
    if (photoIds.length) mutations.removeFromAlbum(album.albumId, album.title, photoIds, imageHashes);
    clear();
  }, [album, state, mutations, clear]);

  const runShare = useCallback(() => {
    const hashes = selectedImageHashes(state);
    if (hashes.length === 0) return;
    setShareHashes(hashes);
    setShareOpen(true);
  }, [state]);

  const downloadable = useMemo(() => selectedDownloadableHashes(state), [state]);
  const runDownload = useCallback(() => {
    if (downloadable.length === 0) return;
    void online.saveToPhone(downloadable);
    clear();
  }, [downloadable, online, clear]);

  // The server deletes for good only what is in its trash (as the web, which
  // offers it in Trash only), so every other grid leaves the button out.
  const inTrash = directions.deleted === false;
  const runDeletePermanent = useCallback(() => {
    online.confirmDeletePermanently(selectedImageHashes(state), clear);
  }, [online, state, clear]);

  const extras = useMemo<SelectionExtraAction[] | undefined>(
    () =>
      extraActions?.map(({ run, ...action }) => ({
        ...action,
        onPress: () => run({ photoIds: selectedPhotoIds(state), imageHashes: selectedImageHashes(state) }, clear),
      })),
    [extraActions, state, clear]
  );

  const count = selectionCount(state);

  const overlay: ReactElement | null = state.active ? (
    <>
      <SelectionActionBar
        count={count}
        isOnline={isOnline}
        onFavorite={runFavorite}
        onHide={runHide}
        onTrash={runTrash}
        onAddToAlbum={() => setPickerOpen(true)}
        onRemoveFromAlbum={album ? runRemoveFromAlbum : undefined}
        onShareLink={runShare}
        onDownload={downloadable.length > 0 ? runDownload : undefined}
        onDeletePermanent={inTrash ? runDeletePermanent : undefined}
        onArchive={runArchive}
        onRate={runRate}
        onSetCover={coverPick ? runSetCover : undefined}
        extraActions={extras}
        onCancel={clear}
        directions={dir}
      />
      <AlbumPickerSheet
        visible={pickerOpen}
        onPick={onPickAlbum}
        onCreate={onCreateAlbum}
        onCancel={() => setPickerOpen(false)}
      />
      <ShareSheet
        visible={shareOpen}
        imageHashes={shareHashes}
        onClose={() => {
          setShareOpen(false);
          clear();
        }}
      />
    </>
  ) : null;

  return {
    active: state.active,
    count,
    isSelected: (key: string) => isSelectedSel(state, key),
    enter,
    toggle,
    toggleGroup,
    clear,
    overlay,
  };
}
