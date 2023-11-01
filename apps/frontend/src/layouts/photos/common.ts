import type { Dispatch, SetStateAction } from "react";

import type { PigPhoto } from "../../actions/photosActions.types";

export type PhotoGroup = {
  id: string;
  page: number;
  items?: PigPhoto[];
};

export const updatePhotoGroups = (callback: Dispatch<SetStateAction<PhotoGroup>>) => (groups: PhotoGroup[]) => {
  const photoGroups = groups ?? [];
  photoGroups.forEach(group => {
    const photos = (group.items ?? []).filter(i => i.isTemp);
    if (photos.length > 0) {
      const firstTempObject = photos[0];
      const page = Math.ceil((parseInt(firstTempObject.id, 10) + 1) / 100);
      callback({ id: group.id, page: page });
    }
  });
};
