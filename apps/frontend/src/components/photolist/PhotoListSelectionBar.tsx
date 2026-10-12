import { Box, Group, useComputedColorScheme, useMantineTheme } from "@mantine/core";
import { useLocation } from "@tanstack/react-router";
import type { BulkPhotoQuery, PigPhoto, SelectionState } from "../../api_client/photos/types";
import { SelectionActions } from "./SelectionActions";
import type { AlbumCoverType } from "./SelectionActions";
import { SelectionBar } from "./SelectionBar";
import { TrashcanActions } from "./TrashcanActions";
import type { PhotoListDialogState } from "./usePhotoListDialogs";

type Props = Readonly<{
  selectionState: SelectionState;
  idx2hash: PigPhoto[];
  updateSelectionState: (state: Partial<SelectionState>) => void;
  photosetQuery?: BulkPhotoQuery;
  totalCount: number;
  albumID?: string;
  ownerUsername?: string;
  albumLocked: boolean;
  title: string;
  setAlbumCover: (actionType: AlbumCoverType, photoId?: string) => void;
  dialogs: PhotoListDialogState;
}>;

// The selection bar under a photo list's toolbar: the selection count, the actions
// on the selected photos and the trashcan actions.
export function PhotoListSelectionBar({
  selectionState,
  idx2hash,
  updateSelectionState,
  photosetQuery,
  totalCount,
  albumID,
  ownerUsername,
  albumLocked,
  title,
  setAlbumCover,
  dialogs,
}: Props) {
  const location = useLocation();
  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme("light");
  return (
    <Box
      style={{
        padding: 4,
        backgroundColor: colorScheme === "dark" ? theme.colors.dark[7] : theme.colors.gray[2],
        textAlign: "center",
        cursor: "pointer",
        borderRadius: 10,
      }}
    >
      <Group
        style={{
          paddingLeft: 10,
        }}
        justify="space-between"
      >
        <SelectionBar
          selectMode={selectionState.selectMode}
          selectAllMode={selectionState.selectAllMode}
          selectedItems={selectionState.selectedItems}
          idx2hash={idx2hash}
          updateSelectionState={updateSelectionState}
          photosetQuery={photosetQuery}
          totalCount={totalCount}
        />
        <Group justify="flex-end">
          {!location.pathname.startsWith("/deleted") && (
            <SelectionActions
              selectedItems={selectionState.selectedItems}
              selectAllMode={selectionState.selectAllMode}
              selectAllQuery={selectionState.selectAllQuery}
              totalCount={totalCount}
              albumID={albumID}
              ownerUsername={ownerUsername}
              albumLocked={albumLocked}
              title={title}
              setAlbumCover={setAlbumCover}
              onSharePhotos={() => dialogs.sharePhotos.open()}
              onShareAlbum={() => dialogs.albumShare.open()}
              onAddToAlbum={() => dialogs.addToAlbum.open()}
              onAddTags={() => dialogs.tag.open()}
              updateSelectionState={updateSelectionState}
            />
          )}
          <TrashcanActions
            selectedItems={selectionState.selectedItems}
            selectAllMode={selectionState.selectAllMode}
            selectAllQuery={selectionState.selectAllQuery}
            totalCount={totalCount}
            updateSelectionState={updateSelectionState}
          />
        </Group>
      </Group>
    </Box>
  );
}
