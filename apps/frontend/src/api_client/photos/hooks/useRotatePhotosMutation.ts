import { endpoints, photoKeys } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient, queryClient } from "../../api";
import { invalidatePhotoLists } from "../invalidatePhotoLists";

type RotatePhotoRequest = {
  image_hash: string;
  /** The turn the user chose, in degrees clockwise as seen on screen; negative turns counter-clockwise. */
  clockwiseDegrees: number;
};

// Rotate a photo non-destructively. A positive server angle turns the rendered photo
// counter-clockwise (the thumbnail renderer draws local orientation 6 as a quarter turn
// counter-clockwise, see exif_orientation_showing in the backend), so the hook negates the
// user's turn; the toast names the user's direction, not the server's angle (#2587).
export const useRotatePhotosMutation = () =>
  useMutation({
    mutationFn: (request: RotatePhotoRequest) =>
      endpoints.rotatePhoto(apiClient, request.image_hash, -request.clockwiseDegrees),
    onSuccess: (_data, request) => {
      notification.photoRotated(request.clockwiseDegrees);

      invalidatePhotoLists(queryClient);
      queryClient.invalidateQueries({ queryKey: photoKeys.detail(request.image_hash) });
    },
  });
