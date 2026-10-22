import { useSyncExternalStore } from "react";
import { drawnFaceResults } from "../drawnFaceResults";
import { useAddFaceMutation } from "./useAddFaceMutation";

/** What became of the last box drawn on a photo (#1117), with a way to keep a box no face was found in. */
export type DrawnFaceOutcome = Readonly<{
  state: "finding" | "notfound";
  /** Save the box as drawn, under the name already chosen. */
  keepBox: () => void;
}>;

const nothing = () => undefined;

/** The last box drawn on the photo `imageHash` while the server looks in it or found no face there, else null. */
export function useDrawnFaceResult(imageHash: string | undefined): DrawnFaceOutcome | null {
  const { mutate } = useAddFaceMutation();
  const result = useSyncExternalStore(
    drawnFaceResults.subscribe,
    imageHash ? () => drawnFaceResults.get(imageHash) : nothing
  );
  if (!result) return null;
  return { state: result.state, keepBox: () => mutate({ ...result.request, fit: false }) };
}
