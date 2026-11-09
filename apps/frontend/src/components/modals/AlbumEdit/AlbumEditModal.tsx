import type { UserAlbumInfo } from "@librephotos/api-client";
import { FocusTrap, Modal, TextInput } from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useAddPhotoToUserAlbumMutation,
  useCreateUserAlbumMutation,
  useFetchUserAlbumsQuery,
} from "../../../api_client/albums/hooks";
import type { SelectAllAlbumFields } from "../../../api_client/albums/types";
import { useAuth } from "../../../hooks/useAuth";
import { parseInstant } from "../../../util/dateUtils";
import { fuzzyMatch } from "../../../util/util";
import { pickedPhotos, selectAllOf, selectedCount } from "../../photolist/photoListSelection";
import type { PhotoRef, Selected } from "../../photolist/photoListSelection";
import { selectionLabel } from "../../photolist/selectionLabel";
import { DIALOG_SIZE } from "../dialogSize";
import { modalTitleStyles } from "../modalTitleStyles";
import classes from "./AlbumEditModal.module.css";
import { AlbumPickerRow } from "./AlbumPickerRow";
import { ContributeStep } from "./ContributeStep";
import { NewAlbumRow, useNewAlbumForm } from "./NewAlbumRow";
import { SharedAlbumsYouCanAdd } from "./SharedAlbumsYouCanAdd";

type Props = Readonly<{
  isOpen: boolean;
  onRequestClose: () => void;
  selection: Selected<PhotoRef>;
}>;

/**
 * Where the picker is: the list (`creating` while the new album's row takes a title), or the
 * second step for an album someone shared with you as a contributor (#464), which says who will
 * see the photos and what of them before anything is added.
 */
type Step = Readonly<{ kind: "pick"; creating: boolean }> | Readonly<{ kind: "contribute"; album: UserAlbumInfo }>;

const PICK: Step = { kind: "pick", creating: false };

/** More albums than this and the picker starts with a search field (Immich). */
const SEARCH_FROM = 6;

/** "7 items · Created 7 hours ago", in full words: one meta line for an album of one's own. */
function albumMeta(t: TFunction, album: UserAlbumInfo): string {
  const created = parseInstant(album.created_on).toRelative();
  const items = t("modalalbum.items", { count: album.photo_count });
  return created ? `${items} · ${t("modalalbum.created", { duration: created })}` : items;
}

/**
 * Add to album (Google Photos' picker): "2 items selected" under the title, a filled search field
 * for a long list, then one list whose first row makes a new album in place, then your albums and
 * the shared ones you may add to.
 */
export function AlbumEditModal(props: Props) {
  const { isOpen, onRequestClose, selection } = props;
  const { t } = useTranslation();
  const { data: albumsUserList = [] } = useFetchUserAlbumsQuery();
  const createUserAlbum = useCreateUserAlbumMutation();
  const addPhotoToUserAlbum = useAddPhotoToUserAlbumMutation();
  const { userId } = useAuth();
  const [step, setStep] = useState<Step>(PICK);
  const [search, setSearch] = useState("");
  const form = useNewAlbumForm(albumsUserList.map(album => album.title));

  const count = selectedCount(selection);
  const selectAll = selectAllOf(selection);
  // The server resolves select-all through the same query the view uses (incl.
  // the photos/videos filter), so the payload matches exactly what is on screen.
  const selectAllFields: SelectAllAlbumFields = selectAll
    ? { select_all: true, query: selectAll.query, excluded_hashes: selectAll.excludedHashes, photoCount: count }
    : {};
  const photos = pickedPhotos(selection).map(i => i.id);

  // The parent keeps this component mounted, so every way out must clear the search and the new
  // album's title: a leftover filter would otherwise reopen with albums missing.
  const close = () => {
    onRequestClose();
    form.reset();
    setSearch("");
    setStep(PICK);
  };

  if (step.kind === "contribute") {
    return (
      <Modal
        size={DIALOG_SIZE.md}
        styles={modalTitleStyles}
        zIndex={1500}
        opened={isOpen}
        title={t("modalalbum.title")}
        onClose={close}
      >
        <ContributeStep
          album={step.album}
          photoIds={photos}
          selectAll={selectAll}
          count={count}
          myId={userId}
          onBack={() => setStep(PICK)}
          onDone={close}
        />
      </Modal>
    );
  }

  const query = search.trim();
  const albums = albumsUserList.filter(album => fuzzyMatch(query, album.title));
  const subtitle = selection.kind === "all" ? selectionLabel(t, selection) : t("modalalbum.itemsselected", { count });

  return (
    <Modal
      size={DIALOG_SIZE.md}
      styles={modalTitleStyles}
      zIndex={1500}
      opened={isOpen}
      // "2 items selected" under the title, inside the heading (spans: valid in its h2)
      title={
        <>
          {t("modalalbum.title")}
          <span className={classes.subtitle}>{subtitle}</span>
        </>
      }
      onClose={close}
    >
      {albumsUserList.length > SEARCH_FROM ? (
        <TextInput
          data-autofocus
          variant="filled"
          size="sm"
          radius="md"
          className={classes.search}
          leftSection={<IconSearch size={18} />}
          placeholder={t("modalalbum.search")}
          aria-label={t("modalalbum.search")}
          value={search}
          onChange={event => setSearch(event.currentTarget.value)}
        />
      ) : (
        // No focus ring at open: nothing is focused until Tab
        <FocusTrap.InitialFocus />
      )}
      {/* One list: the new album first, then your albums, then the shared ones you can add to */}
      <div className={classes.list}>
        <NewAlbumRow
          form={form}
          editing={step.creating}
          onEdit={creating => setStep({ kind: "pick", creating })}
          onCreate={title => {
            createUserAlbum.mutate({ title, photos, ...selectAllFields });
            close();
          }}
        />
        {albums.map(item => (
          <AlbumPickerRow
            key={`ub-${item.id}`}
            title={item.title}
            meta={albumMeta(t, item)}
            cover={item.cover_photo}
            locked={item.locked}
            onPick={() => {
              addPhotoToUserAlbum.mutate({
                id: `${item.id}`,
                title: item.title,
                photos,
                ...selectAllFields,
              });
              close();
            }}
          />
        ))}
        <SharedAlbumsYouCanAdd filter={query} onPick={album => setStep({ kind: "contribute", album })} />
      </div>
    </Modal>
  );
}
