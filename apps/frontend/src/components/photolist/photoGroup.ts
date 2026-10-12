import type { PigPhoto } from "../../api_client/photos/types";

/** A day page of a paginated date list that is still to load (`id`: the date album's). */
export type PhotoGroup = {
  id: number;
  page: number;
  items?: PigPhoto[];
};

/** The day page to load before Pig has reported one: no id (0), so the day query is skipped. */
export const NO_PHOTO_GROUP: PhotoGroup = { id: 0, page: 1 };
