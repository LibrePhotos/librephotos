import React from "react";
import type { PhotoSelection } from "../../api_client/photos/photoSelection";
import { BulkLocationModal } from "../map/BulkLocationModal";
import { MovePhotosModal } from "../movephotos/MovePhotosModal";
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

const FOLDER_PAGE = "/album/folder/";

/** The folder a folder page shows; undefined on any other page. */
const folderOfPage = (pathname: string): string | undefined =>
  pathname.startsWith(FOLDER_PAGE) ? decodeURIComponent(pathname.slice(FOLDER_PAGE.length)) : undefined;

/**
 * The dialogs that edit the selection: its date, its location and its folder. Each is mounted only
 * while open, because each asks the server about the selection when it opens.
 */
export function SelectionEditDialogs({ dialogs, selection, onDone, pathname }: Props) {
  const { dateTime, location, move } = dialogs;
  return (
    <>
      {dateTime.opened && (
        <ChangeDateTimeModal opened onClose={dateTime.close} selection={selection()} onSaved={onDone} />
      )}
      {location.opened && <BulkLocationModal opened onClose={location.close} selection={selection()} onDone={onDone} />}
      {move.opened && (
        <MovePhotosModal
          opened
          onClose={move.close}
          selection={selection()}
          onDone={onDone}
          currentFolder={folderOfPage(pathname)}
        />
      )}
    </>
  );
}
