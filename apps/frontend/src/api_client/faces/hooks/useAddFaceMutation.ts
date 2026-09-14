import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { notification } from "../../../service/notifications";
import { recordRecentlyTaggedPerson } from "../../../util/recentlyTaggedPeople";
import { parseWithNotification } from "../../../util/zodUtils";
import { PeopleAlbumsQueryKeys } from "../../albums/hooks/useFetchPeopleAlbumsQuery";
import { fetchClient, queryClient } from "../../api";
import { PhotoDetailsQueryKeys } from "../../photos/hooks/useFetchPhotoDetailsQuery";
import { CountStatsQueryKeys } from "../../stats/hooks/useFetchCountStatsQuery";
import { FacesQueryKeys } from "./useFetchFacesQuery";
import { IncompleteFacesQueryKeys } from "./useFetchIncompleteFacesQuery";

/** A box the user drew, each side a fraction of the displayed image. */
export type NormalizedFaceBox = z.infer<typeof NormalizedFaceBox>;
export const NormalizedFaceBox = z.object({
  top: z.number(),
  right: z.number(),
  bottom: z.number(),
  left: z.number(),
});

export type AddFaceRequest = z.infer<typeof AddFaceRequest>;
export const AddFaceRequest = z.object({
  photo: z.string(),
  personName: z.string(),
  box: NormalizedFaceBox,
});

export type AddFaceResponse = z.infer<typeof AddFaceResponse>;
export const AddFaceResponse = z.object({
  status: z.boolean(),
  face: z.object({
    face_id: z.number(),
    face_url: z.string(),
    person: z.number(),
    person_name: z.string(),
    // Pixels in big-thumbnail space, the way every other face reports its box.
    location: z.object({
      top: z.number(),
      right: z.number(),
      bottom: z.number(),
      left: z.number(),
    }),
  }),
});

const addFace = (data: AddFaceRequest) =>
  fetchClient
    .post<AddFaceResponse>("/addface", {
      photo: data.photo,
      person_name: data.personName,
      box: data.box,
    })
    .then(response => {
      const payload = parseWithNotification(AddFaceResponse, response, "Failed to parse add face response");
      notification.addFacesToPerson(payload.face.person_name, 1);
      return payload;
    });

export const useAddFaceMutation = () =>
  useMutation({
    mutationFn: addFace,
    onSuccess: data => {
      // Drawing a box by hand is a tagging choice like any other, so it belongs
      // in the recently-tagged shortcut list too.
      recordRecentlyTaggedPerson(data.face.person);

      // Same delay the other face mutations use, for the writes that follow the
      // response (face count, cover photo, search captions).
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: IncompleteFacesQueryKeys });
        queryClient.invalidateQueries({ queryKey: FacesQueryKeys });
        queryClient.invalidateQueries({ queryKey: PeopleAlbumsQueryKeys });
        queryClient.invalidateQueries({ queryKey: CountStatsQueryKeys });
        queryClient.invalidateQueries({ queryKey: PhotoDetailsQueryKeys });
      }, 100);
    },
  });
