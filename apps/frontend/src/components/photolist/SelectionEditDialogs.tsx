import { Modal } from "@mantine/core";
import React, { Suspense } from "react";
import type { PhotoSelection } from "../../api_client/photos/photoSelection";
import { FeatureBoundary, FeatureFallback } from "../common/FeatureBoundary";
import { lazyWithPreload } from "../common/lazyWithPreload";
import { PageLoader } from "../common/PageLoader";
import type { BulkLocationModal as BulkLocationComponent } from "../map/BulkLocationModal";
import { MovePhotosModal } from "../movephotos/MovePhotosModal";
import { RenamePhotosModal } from "../movephotos/RenamePhotosModal";
import { SetRightsModal } from "../rights/SetRightsModal";
import { ChangeDateTimeModal } from "./ChangeDateTimeModal";
import type { SelectionEditDialogState } from "./useSelectionEditDialogs";

type Props = Readonly<{
  dialogs: SelectionEditDialogState;
  /** The selection as the bulk photo actions name it, read when a dialog opens. */
  selection: () => PhotoSelection;
  /** A dialog saved its change: the selection is done with. */
  onDone: () => void;
  /** The page's path: on a folder page the move dialog marks that folder. */
  pathname: string;
}>;

type BulkLocationProps = React.ComponentProps<typeof BulkLocationComponent>;

// The location dialog brings MapLibre (about 300 kB gzipped): its own chunk, loaded when it opens, so
// every photo grid does not carry the map.
export const bulkLocation = lazyWithPreload<BulkLocationProps>(
  async () => (await import("../map/BulkLocationModal")).BulkLocationModal
);

/** The location dialog; while its chunk loads, a dialog of the same kind with a spinner. */
function BulkLocationSlot(props: BulkLocationProps) {
  const pending = (body: React.ReactNode) => (
    <Modal opened onClose={props.onClose} centered>
      {body}
    </Modal>
  );
  return (
    <FeatureBoundary
      name="bulk-location"
      onReset={bulkLocation.retry}
      fallback={({ reset }) => pending(<FeatureFallback reset={reset} />)}
    >
      <Suspense fallback={pending(<PageLoader />)}>
        <bulkLocation.Component {...props} />
      </Suspense>
    </FeatureBoundary>
  );
}

const FOLDER_PAGE = "/album/folder/";

/** The folder a folder page shows; undefined on any other page. */
const folderOfPage = (pathname: string): string | undefined =>
  pathname.startsWith(FOLDER_PAGE) ? decodeURIComponent(pathname.slice(FOLDER_PAGE.length)) : undefined;

/**
 * The dialogs that edit the selection: its date, its location, its folder, its file names and its
 * rights. Each is mounted only
 * while open, because each asks the server about the selection when it opens.
 */
export function SelectionEditDialogs({ dialogs, selection, onDone, pathname }: Props) {
  const { dateTime, location, move, rename, rights } = dialogs;
  return (
    <>
      {dateTime.opened && (
        <ChangeDateTimeModal opened onClose={dateTime.close} selection={selection()} onSaved={onDone} />
      )}
      {location.opened && <BulkLocationSlot opened onClose={location.close} selection={selection()} onDone={onDone} />}
      {move.opened && (
        <MovePhotosModal
          opened
          onClose={move.close}
          selection={selection()}
          onDone={onDone}
          currentFolder={folderOfPage(pathname)}
        />
      )}
      {rename.opened && <RenamePhotosModal opened onClose={rename.close} selection={selection()} onDone={onDone} />}
      {rights.opened && <SetRightsModal opened onClose={rights.close} selection={selection()} onDone={onDone} />}
    </>
  );
}
