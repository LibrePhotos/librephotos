import type { BulkPhotoMutationResponse } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import type { PhotoSelection } from "../photoSelection";

/** Puts back what a toast reports. */
type Undo = () => Promise<unknown>;

type BulkPhotoToggle<Request extends PhotoSelection> = Readonly<{
  /** Sends the change. */
  send: (request: Request) => Promise<BulkPhotoMutationResponse>;
  /** Marks what the change makes stale; runs after the change and after its Undo. */
  refresh: (request: Request) => void;
  /** The request that sets `imageHashes` back to how they were before `request`. */
  invert: (request: Request, imageHashes: string[]) => Request;
  /** The toast: how many photos changed, and its Undo when the change can be undone. */
  notify: (count: number, request: Request, undo: Undo | undefined) => void;
}>;

/** How many photos changed: the server's count, else (older servers) the photos sent. */
function changedCount(data: BulkPhotoMutationResponse, selection: PhotoSelection): number {
  return data.count ?? (selection.select_all ? 0 : selection.image_hashes.length);
}

/**
 * The photos the change can be undone on: the ones the server says it changed, so photos that
 * already were favorites stay favorites after an Undo. A select-all answer names no photos, and
 * neither does an older server, so those changes get no Undo.
 */
function undoableHashes(data: BulkPhotoMutationResponse, selection: PhotoSelection): string[] {
  return selection.select_all ? [] : (data.updated_hashes ?? []);
}

/**
 * A bulk on/off change of photos (favorite, hidden, archived, public) whose toast has an Undo
 * (#127): the opposite value, sent for the photos the server changed. The Undo shows no toast of
 * its own (its toast closes), and a failed Undo is reported by the QueryClient like any failed
 * change. A change that changed nothing gets no "0 photos" toast.
 */
export function useBulkPhotoToggle<Request extends PhotoSelection>({
  send,
  refresh,
  invert,
  notify,
}: BulkPhotoToggle<Request>) {
  const { mutateAsync: setBack } = useMutation({
    mutationFn: send,
    onSuccess: (_data, request) => refresh(request),
  });
  return useMutation({
    mutationFn: send,
    onSuccess: (data, request) => {
      const count = changedCount(data, request);
      const changed = undoableHashes(data, request);
      const undo = changed.length > 0 ? () => setBack(invert(request, changed)) : undefined;
      if (count > 0) notify(count, request, undo);
      refresh(request);
    },
  });
}
