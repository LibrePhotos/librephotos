import type { Photo } from "../../actions/photosActions.types";

export type PhotoSliceState = {
  photoDetails: { [key: string]: Photo };
};
