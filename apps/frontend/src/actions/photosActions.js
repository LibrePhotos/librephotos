import axios from "axios";
import {Server, serverAddress} from '../api_client/apiClient'
import _ from 'lodash'
import moment from 'moment'
import {notify} from 'reapop'

import { fetchDateAlbumsPhotoHashList } from './albumsActions'
import { copyToClipboard } from '../util/util'


export function setPhotosPublic(image_hashes,val_public) {
  return function(dispatch) {
    dispatch({type: "SET_PHOTOS_PUBLIC"});
    Server.post(`photosedit/makepublic/`,{image_hashes:image_hashes,val_public:val_public})
      .then((response) => {
        dispatch({type: "SET_PHOTOS_PUBLIC_FULFILLED", payload: {image_hashes:image_hashes,val_public:val_public,updatedPhotos:response.data.results}})
        if (val_public) {
            var notificationMessage = 'were successfully added to your public photos. Links to the photos were copied to the clipboard.'
            // console.log('links to copy')
            // console.log(image_hashes.map(ih=>{return serverAddress+'/media/photos/'+ih+'.jpg'}).join(' '))
            const linksToCopy = image_hashes.map(ih=>{return serverAddress+'/media/photos/'+ih+'.jpg'}).join(' ')

            // copyToClipboard(image_hashes.map(ih=>{return serverAddress+'/media/photos/'+ih+'.jpg'}).join(' '))
            // copyToClipboard('helaelkqwjelkrqwer')
        } else {
            var notificationMessage = 'were successfully removed from your public photos'
        }
        dispatch(notify({
            message:`${image_hashes.length} photo(s) ` + notificationMessage,
            title:'Set photos public',
            status:'success',
            dismissible: true,
            dismissAfter:3000,
            position:'br'
        }))
        if (image_hashes.length == 1) {
          dispatch(fetchPhotoDetail(image_hashes[0]))
        }
      })
      .catch((err) => {
        dispatch({type: "SET_PHOTOS_PUBLIC_REJECTED", payload: err})
      })
  }
}




export function setPhotosFavorite(image_hashes,favorite) {
  return function(dispatch) {
    dispatch({type: "SET_PHOTOS_FAVORITE"});
    Server.post(`photosedit/favorite/`,{image_hashes:image_hashes,favorite:favorite})
      .then((response) => {
        dispatch({type: "SET_PHOTOS_FAVORITE_FULFILLED", payload: {image_hashes:image_hashes,favorite:favorite,updatedPhotos:response.data.results}})
        if (favorite) {
            var notificationMessage = 'were successfully added to favorites'
        } else {
            var notificationMessage = 'were successfully removed from favorites'
        }
        dispatch(notify({
            message:`${image_hashes.length} photo(s) ` + notificationMessage,
            title:'Favorite photos',
            status:'success',
            dismissible: true,
            dismissAfter:3000,
            position:'br'
        }))
        if (image_hashes.length == 1) {
          dispatch(fetchPhotoDetail(image_hashes[0]))
        }
      })
      .catch((err) => {
        dispatch({type: "SET_PHOTOS_FAVORITE_REJECTED", payload: err})
      })
  }
}

export function setPhotosHidden(image_hashes,hidden) {
  return function(dispatch) {
    dispatch({type: "SET_PHOTOS_HIDDEN"});
    Server.post(`photosedit/hide/`,{image_hashes:image_hashes,hidden:hidden})
      .then((response) => {
        dispatch({type: "SET_PHOTOS_HIDDEN_FULFILLED", payload: {image_hashes:image_hashes,hidden:hidden,updatedPhotos:response.data.results}})
        if (hidden) {
            var notificationMessage = 'were successfully hidden'
        } else {
            var notificationMessage = 'were successfully unhidden'
        }
        dispatch(notify({
            message:`${image_hashes.length} photo(s) ` + notificationMessage,
            title:'Hide photos',
            status:'success',
            dismissible: true,
            dismissAfter:3000,
            position:'br'
        }))
        if (image_hashes.length == 1) {
          dispatch(fetchPhotoDetail(image_hashes[0]))
        }
      })
      .catch((err) => {
        dispatch({type: "SET_PHOTOS_HIDDEN_REJECTED", payload: err})
      })
  }
}



export function scanPhotos() {
  return function(dispatch) {
    dispatch({type: "SCAN_PHOTOS"});
    dispatch({type:"SET_WORKER_AVAILABILITY",payload:false})

    Server.get(`scanphotos/`)
      .then((response) => {
        dispatch(notify({
          message:'Scan Photos started',
          title:'Scan Photos',
          status:'success',
          dismissible: true,
          dismissAfter:3000,
          position:'br'
        }))
        dispatch({type: "SCAN_PHOTOS_FULFILLED", payload: response.data})
      })
      .catch((err) => {
        dispatch({type: "SCAN_PHOTOS_REJECTED", payload: err})
      })
  }
}


export function fetchPhotos() {
  return function(dispatch) {
    dispatch({type:"FETCH_PHOTOS"});
    Server.get('photos/list/',{timeout:100000})
      .then((response) => {
        var t0 = performance.now();
        const res = _.keyBy(response.data.results,'image_hash')
        var t1 = performance.now();
        console.log("Call to doSomething took " + (t1 - t0) + " milliseconds.")
        dispatch({type:"FETCH_PHOTOS_FULFILLED",payload: res})
        // dispatch(fetchDateAlbumsPhotoHashList())
      }) 
      .catch((err) => {
        dispatch({type:"FETCH_PHOTOS_REJECTED",payload: err})        
      })
  }
}


export function fetchFavoritePhotos() {
  return function(dispatch) {
    dispatch({type:"FETCH_FAVORITE_PHOTOS"});
    Server.get('photos/favorites/',{timeout:100000})
      .then((response) => {
        //var t0 = performance.now();
        //const res = _.keyBy(response.data.results,'image_hash')
        //var t1 = performance.now();
        //console.log("Call to doSomething took " + (t1 - t0) + " milliseconds.")
        dispatch({type:"FETCH_FAVORITE_PHOTOS_FULFILLED",payload: response.data.results})
        // dispatch(fetchDateAlbumsPhotoHashList())
      }) 
      .catch((err) => {
        dispatch({type:"FETCH_FAVORITE_PHOTOS_REJECTED",payload: err})        
      })
  }
}


export function fetchHiddenPhotos() {
  return function(dispatch) {
    dispatch({type:"FETCH_HIDDEN_PHOTOS"});
    Server.get('photos/hidden/',{timeout:100000})
      .then((response) => {
        //var t0 = performance.now();
        //const res = _.keyBy(response.data.results,'image_hash')
        //var t1 = performance.now();
        //console.log("Call to doSomething took " + (t1 - t0) + " milliseconds.")
        dispatch({type:"FETCH_HIDDEN_PHOTOS_FULFILLED",payload: response.data.results})
        // dispatch(fetchDateAlbumsPhotoHashList())
      }) 
      .catch((err) => {
        dispatch({type:"FETCH_HIDDEN_PHOTOS_REJECTED",payload: err})        
      })
  }
}



export function fetchPhotoDetail(image_hash) {
  return function(dispatch) {
    dispatch({type:"FETCH_PHOTO_DETAIL",payload:image_hash});
    Server.get(`photos/${image_hash}/`,{timeout:100000})
      .then((response) => {
        console.log(response)
        dispatch({type:"FETCH_PHOTO_DETAIL_FULFILLED",payload: response.data})
      }) 
      .catch((err) => {
        console.log(image_hash)
        dispatch({type:"FETCH_PHOTO_DETAIL_REJECTED",payload: err})        
      })
  }
}



export function simpleFetchPhotos() {
  return function(dispatch) {
    dispatch({type:"FETCH_PHOTOS"});
    Server.get('photos/',{timeout:100000})
      .then((response) => {
        dispatch({type:"FETCH_PHOTOS_FULFILLED",payload: response.data.results})
      }) 
      .catch((err) => {
        dispatch({type:"FETCH_PHOTOS_REJECTED",payload: err})        
      })
  }
}




export function fetchNoTimestampPhotoList() {
  return function(dispatch) {
    dispatch({type:"FETCH_NO_TIMESTAMP_PHOTOS"});
    Server.get('photos/notimestamp/list/',{timeout:100000})
      .then((response) => {
        dispatch({type:"FETCH_NO_TIMESTAMP_PHOTOS_FULFILLED",payload: response.data.results})
      }) 
      .catch((err) => {
        dispatch({type:"FETCH_NO_TIMESTAMP_PHOTOS_REJECTED",payload: err})        
      })
  }
}




