import { peopleAlbumsApi } from "../api_client/albums/people";
import { Server } from "../api_client/apiClient";
import { notification } from "../service/notifications";

export function setAlbumCoverForPerson(person_id, photo_hash) {
  return function cb(dispatch) {
    dispatch({ type: "SET_ALBUM_COVER_FOR_PERSON" });
    Server.patch(`persons/${person_id}/`, {
      cover_photo: photo_hash,
    })
      .then(() => {
        // To-Do: I should do something with the response
        dispatch({ type: "SET_ALBUM_COVER_FOR_PERSON_FULFILLED" });
        notification.setCoverPhoto();
        dispatch(peopleAlbumsApi.endpoints.fetchPeopleAlbums.initiate());
      })
      .catch(payload => {
        dispatch({ type: "SET_ALBUM_COVER_FOR_PERSON_REJECTED", payload });
      });
  };
}
