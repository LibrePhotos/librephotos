import { Server } from "../api_client/apiClient";
import _ from "lodash";
import { notify } from "reapop";
import { push } from "react-router-redux";

export function fetchThingAlbumsList() {
  return function(dispatch) {
    dispatch({ type: "FETCH_THING_ALBUMS_LIST" });
    Server.get("albums/thing/list/")
      .then(response => {
        dispatch({
          type: "FETCH_THING_ALBUMS_LIST_FULFILLED",
          payload: response.data.results
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_THING_ALBUMS_LIST_REJECTED", payload: err });
      });
  };
}

export function fetchThingAlbum(album_id) {
  return function(dispatch) {
    dispatch({ type: "FETCH_THING_ALBUMS" });
    Server.get(`albums/thing/${album_id}/`)
      .then(response => {
        dispatch({
          type: "FETCH_THING_ALBUMS_FULFILLED",
          payload: response.data
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_THING_ALBUMS_REJECTED", payload: err });
      });
  };
}

export function fetchUserAlbumsList() {
  return function(dispatch) {
    dispatch({ type: "FETCH_USER_ALBUMS_LIST" });
    Server.get("albums/user/list/")
      .then(response => {
        dispatch({
          type: "FETCH_USER_ALBUMS_LIST_FULFILLED",
          payload: response.data.results
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_USER_ALBUMS_LIST_REJECTED", payload: err });
      });
  };
}

export function fetchUserAlbum(album_id) {
  return function(dispatch) {
    dispatch({ type: "FETCH_USER_ALBUMS" });
    Server.get(`albums/user/${album_id}/`)
      .then(response => {
        dispatch({
          type: "FETCH_USER_ALBUMS_FULFILLED",
          payload: response.data
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_USER_ALBUMS_REJECTED", payload: err });
      });
  };
}

export function createNewUserAlbum(title, image_hashes) {
  return function(dispatch) {
    dispatch({ type: "CREATE_USER_ALBUMS_LIST" });
    Server.post("albums/user/edit/", { title: title, photos: image_hashes })
      .then(response => {
        dispatch({
          type: "CREATE_USER_ALBUMS_LIST_FULFILLED",
          payload: response.data
        });
        dispatch(fetchUserAlbumsList());
        dispatch(
          notify({
            message: `${
              image_hashes.length
            } photo(s) were successfully added to new album "${title}"`,
            title: "Create album",
            status: "success",
            dismissible: true,
            dismissAfter: 3000,
            position: "br",
            buttons:[{
              name:'View Album', 
              primary:true, 
              onClick: ()=>{
                dispatch(fetchUserAlbum(response.data.id))
                dispatch(push(`/useralbum/${response.data.id}/`))
                console.log(response.data.id)
              }
            }]

          })
        );
      })
      .catch(err => {
        dispatch({ type: "CREATE_USER_ALBUMS_LIST_REJECTED", payload: err });
      });
  };
}

export function deleteUserAlbum(albumID, albumTitle) {
  return function(dispatch) {
    dispatch({ type: "DELTE_USER_ALBUM" });
    Server.delete(`/albums/user/${albumID}`)
      .then(response => {
        dispatch({ type: "DELETE_USER_ALBUM_FULFILLED", payload: albumID });
        dispatch(fetchUserAlbumsList());
        dispatch(
          notify({
            message: `${albumTitle} was successfully deleted.`,
            title: "Delete album",
            status: "success",
            dismissible: true,
            dismissAfter: 3000,
            position: "br"
          })
        );
      })
      .catch(err => {
        dispatch({ type: "DELETE_USER_ALBUM_REJECTED", payload: err });
      });
  };
}

export function editUserAlbum(album_id, title, image_hashes) {
  return function(dispatch) {
    dispatch({ type: "EDIT_USER_ALBUMS_LIST" });
    Server.patch(`albums/user/edit/${album_id}/`, {
      title: title,
      photos: image_hashes
    })
      .then(response => {
        dispatch({
          type: "EDIT_USER_ALBUMS_LIST_FULFILLED",
          payload: response.data
        });
        dispatch(
          notify({
            message: `${
              image_hashes.length
            } photo(s) were successfully added to existing album "${title}"`,
            title: "Add to album",
            status: "success",
            dismissible: true,
            dismissAfter: 3000,
            position: "br",
            buttons:[{
              name:'View Album', 
              primary:true, 
              onClick: ()=>{
                dispatch(fetchUserAlbum(album_id))
                dispatch(push(`/useralbum/${album_id}/`))
              }
            }]
          })
        );
        dispatch(fetchUserAlbumsList());
      })
      .catch(err => {
        dispatch({ type: "EDIT_USER_ALBUMS_LIST_REJECTED", payload: err });
      });
  };
}

export function fetchPlaceAlbumsList() {
  return function(dispatch) {
    dispatch({ type: "FETCH_PLACE_ALBUMS_LIST" });
    Server.get("albums/place/list/")
      .then(response => {
        var byGeolocationLevel = _.groupBy(
          response.data.results,
          el => el.geolocation_level
        );
        dispatch({
          type: "GROUP_PLACE_ALBUMS_BY_GEOLOCATION_LEVEL",
          payload: byGeolocationLevel
        });
        dispatch({
          type: "FETCH_PLACE_ALBUMS_LIST_FULFILLED",
          payload: response.data.results
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_PLACE_ALBUMS_LIST_REJECTED", payload: err });
      });
  };
}

export function fetchPlaceAlbum(album_id) {
  return function(dispatch) {
    dispatch({ type: "FETCH_PLACE_ALBUMS" });
    Server.get(`albums/place/${album_id}/`)
      .then(response => {
        dispatch({
          type: "FETCH_PLACE_ALBUMS_FULFILLED",
          payload: response.data
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_PLACE_ALBUMS_REJECTED", payload: err });
      });
  };
}

export function fetchPeopleAlbums(person_id) {
  return function(dispatch) {
    dispatch({ type: "FETCH_PEOPLE_ALBUMS" });
    Server.get(`albums/person/${person_id}/`)
      .then(response => {
        dispatch({
          type: "FETCH_PEOPLE_ALBUMS_FULFILLED",
          payload: response.data
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_PEOPLE_ALBUMS_REJECTED", payload: err });
      });
  };
}

export function generateAutoAlbums() {
  return function(dispatch) {
    dispatch({ type: "GENERATE_AUTO_ALBUMS" });
    Server.get("autoalbumgen/")
      .then(response => {
        dispatch({
          type: "GENERATE_AUTO_ALBUMS_FULFILLED",
          payload: response.data
        });
        dispatch(fetchAutoAlbums());
      })
      .catch(err => {
        dispatch({ type: "GENERATE_AUTO_ALBUMS_REJECTED", payload: err });
      });
  };
}

export function fetchAutoAlbums() {
  return function(dispatch) {
    dispatch({ type: "FETCH_AUTO_ALBUMS" });
    Server.get("albums/auto/?page_size=50")
      .then(response => {
        dispatch({
          type: "FETCH_AUTO_ALBUMS_FULFILLED",
          payload: response.data.results
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_AUTO_ALBUMS_REJECTED", payload: err });
      });
  };
}

//actions using new list view in backend

export function fetchAutoAlbumsList() {
  return function(dispatch) {
    dispatch({ type: "FETCH_AUTO_ALBUMS_LIST" });
    Server.get("albums/auto/list/")
      .then(response => {
        dispatch({
          type: "FETCH_AUTO_ALBUMS_LIST_FULFILLED",
          payload: response.data.results
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_AUTO_ALBUMS_LIST_REJECTED", payload: err });
      });
  };
}

export function fetchDateAlbumsList() {
  return function(dispatch) {
    dispatch({ type: "FETCH_DATE_ALBUMS_LIST" });
    Server.get("albums/date/list/", { timeout: 100000 })
      .then(response => {
        dispatch({
          type: "FETCH_DATE_ALBUMS_LIST_FULFILLED",
          payload: response.data.results
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_DATE_ALBUMS_LIST_REJECTED", payload: err });
      });
  };
}

export function fetchDateAlbumsPhotoHashList() {
  return function(dispatch) {
    dispatch({ type: "FETCH_DATE_ALBUMS_PHOTO_HASH_LIST" });
    Server.get("albums/date/photohash/list/", { timeout: 100000 })
      .then(response => {
        var idx2hash = [];
        response.data.results.forEach(day => {
          day.photos.forEach(photo => {
            idx2hash.push(photo.image_hash);
          });
        });
        dispatch({
          type: "FETCH_DATE_ALBUMS_PHOTO_HASH_LIST_FULFILLED",
          payload: response.data.results
        });
        dispatch({ type: "SET_IDX_TO_IMAGE_HASH", payload: idx2hash });
      })
      .catch(err => {
        dispatch({
          type: "FETCH_DATE_ALBUMS_PHOTO_HASH_LIST_REJECTED",
          payload: err
        });
      });
  };
}

//actions using new retrieve view in backend
export function fetchAlbumsAutoGalleries(album_id) {
  return function(dispatch) {
    dispatch({ type: "FETCH_AUTO_ALBUMS_RETRIEVE" });
    Server.get(`albums/auto/${album_id}/`)
      .then(response => {
        dispatch({
          type: "FETCH_AUTO_ALBUMS_RETRIEVE_FULFILLED",
          payload: response.data
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_AUTO_ALBUMS_RETRIEVE_REJECTED", payload: err });
      });
  };
}

export function fetchAlbumsDateGalleries(album_id) {
  return function(dispatch) {
    dispatch({ type: "FETCH_DATE_ALBUMS_RETRIEVE" });
    Server.get(`albums/date/${album_id}/`)
      .then(response => {
        dispatch({
          type: "FETCH_DATE_ALBUMS_RETRIEVE_FULFILLED",
          payload: response.data
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_DATE_ALBUMS_RETRIEVE_REJECTED", payload: err });
      });
  };
}

export function toggleAlbumAutoFavorite(album_id, rating) {
  return function(dispatch) {
    dispatch({ type: "TOGGLE_ALBUM_AUTO_FAVORITE" });
    Server.patch(`albums/auto/list/${album_id}/`, { favorited: rating })
      .then(response => {
        dispatch({
          type: "TOGGLE_ALBUM_AUTO_FAVORITE_FULFILLED",
          payload: response.data
        });
      })
      .catch(err => {
        dispatch({ type: "TOGGLE_ALBUM_AUTO_FAVORITE_REJECTED", payload: err });
      });
  };
}

// share user album
export function setUserAlbumShared(album_id, target_user_id, val_shared) {
  return function(dispatch) {
    dispatch({ type: "SET_ALBUM_USER_SHARED" });
    Server.post("useralbum/share/", {
      shared: val_shared,
      album_id: album_id,
      target_user_id: target_user_id
    })
      .then(response => {
        dispatch({ type: "SET_ALBUM_USER_SHARED_FULFILLED", payload: response.data });
        dispatch(fetchUserAlbum(album_id))

        if (val_shared) {
            dispatch(
            notify({
                message: `Album was successfully shared`,
                title: "Share album",
                status: "success",
                dismissible: true,
                dismissAfter: 3000,
                position: "br"
            })
            );
        } else {
            dispatch(
            notify({
                message: `Album was successfully unshared`,
                title: "Unshare album",
                status: "success",
                dismissible: true,
                dismissAfter: 3000,
                position: "br"
            })
            );
        }
        
      })
      .catch(err => {
        dispatch({ type: "SET_ALBUM_USER_SHARED_FULFILLED", payload: err})
        console.log(err.content)
      });
  };
}



//sharing
export function fetchUserAlbumsSharedToMe() {
  return function(dispatch) {
    dispatch({ type: "FETCH_ALBUMS_SHARED_TO_ME" });
    Server.get("/albums/user/shared/tome/")
      .then(response => {
        const sharedAlbumssGroupedByOwner = _
        .toPairs(_.groupBy(response.data.results, "owner.id"))
        .map(el => {
          return { user_id: parseInt(el[0], 10), albums: el[1] };
        });
        console.log(sharedAlbumssGroupedByOwner)
        dispatch({
          type: "FETCH_ALBUMS_SHARED_TO_ME_FULFILLED",
          payload: sharedAlbumssGroupedByOwner
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_ALBUMS_SHARED_TO_ME_REJECTED", payload: err });
      });
  };
}

export function fetchUserAlbumsSharedFromMe() {
  return function(dispatch) {
    dispatch({ type: "FETCH_ALBUMS_SHARED_FROM_ME" });
    Server.get("/albums/user/shared/fromme/")
      .then(response => {
        console.log(response.data.results)
        dispatch({
          type: "FETCH_ALBUMS_SHARED_FROM_ME_FULFILLED",
          payload: response.data.results
        });
      })
      .catch(err => {
        dispatch({ type: "FETCH_ALBUMS_SHARED_FROM_ME_REJECTED", payload: err });
      });
  };
}
