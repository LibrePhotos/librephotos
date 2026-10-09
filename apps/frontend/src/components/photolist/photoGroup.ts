import type { PigPhoto } from "../../api_client/photos/types";

/** A day page of a paginated date list that is still to load. */
export type PhotoGroup = {
  id: string;
  page: number;
  items?: PigPhoto[];
};

/** The day page to load before Pig has reported one: no id, so the day query is skipped. */
export const NO_PHOTO_GROUP: PhotoGroup = { id: "", page: 1 };
