import { Server } from '../api_client/apiClient'
import _ from 'lodash'
import moment from 'moment'


export function searchPhotos(query) {
  return function(dispatch) {
    if (query.trim().length === 0) {
      dispatch({type:"SEARCH_PHOTOS_EMPTY_QUERY_ERROR"})
      dispatch({type:"SEARCH_EMPTY_QUERY_ERROR"})
    } else {
      var url = `photos/?search=${query}`
      dispatch({type:"SEARCH_PHOTOS",payload: query});
      Server.get(`photos/searchlist/?search=${query}`,{timeout:100000})
        .then((response) => {
          var groupedByDate = _.groupBy(response.data.results,(el)=>{
            if (el.exif_timestamp) {
                return moment.utc(el.exif_timestamp).format('YYYY-MM-DD')
            } else {
                return "No Timestamp"
            }
          })
          var groupedByDateList = _.toPairsIn(groupedByDate).map((el)=>{
            return {date:el[0],photos:el[1]}
          })
          var idx2hash = response.data.results.map((el)=>el.image_hash)

          dispatch({type:"SEARCH_RES_IDX2HASH",payload: idx2hash})
          dispatch({type:"SEARCH_RES_GROUP_BY_DATE",payload: groupedByDateList})
          dispatch({type:"SEARCH_PHOTOS_FULFILLED",payload: response.data.results})
        }) 
        .catch((err) => {
          dispatch({type:"SEARCH_PHOTOS_REJECTED",payload: err})        
        })
    }
  }
}


export function searchPeople(query) {
    return function(dispatch) {
        if (query.trim().length === 0) {
            dispatch({type:"SEARCH_PHOTOS_EMPTY_QUERY_ERROR"}) // remove this line later
            dispatch({type:"SEARCH_EMPTY_QUERY_ERROR"})
        } else {
            var url = `persons/?search=${query}`
            dispatch({type:"SEARCH_PEOPLE"})
            Server.get(url)
            .then((response) => {
                var mappedPeopleDropdownOptions = response.data.results.map(function(person){
                return (
                    {
                    key:person.id,
                    value:person.name,
                    text:person.name,
                    face_url:person.face_url,
                    face_count:person.face_count,
                    face_photo_url:person.face_photo_url
                    }
                )
                })
                dispatch({type: "SEARCH_PEOPLE_FULFILLED", payload: mappedPeopleDropdownOptions})
            })
            .catch((err) => {
                dispatch({type: "SEARCH_PEOPLE_REJECTED", payload: err})
            })
        }
    }
}


export function searchThingAlbums(query) {
  return function(dispatch) {
    dispatch({type:"SEARCH_THING_ALBUMS"});
    Server.get(`albums/thing/list/?search=${query}`)
      .then((response) => {
        dispatch({type:"SEARCH_THING_ALBUMS_FULFILLED", payload: response.data.results})
      })
      .catch((err) => {
        dispatch({type:"SEARCH_THING_ALBUMS_REJECTED", payload: err})        
      })
  }
}

export function searchPlaceAlbums(query) {
  return function(dispatch) {
    dispatch({type:"SEARCH_PLACE_ALBUMS"});
    Server.get(`albums/place/list/?search=${query}`)
      .then((response) => {
        dispatch({type:"SEARCH_PLACE_ALBUMS_FULFILLED", payload: response.data.results})
      })
      .catch((err) => {
        dispatch({type:"SEARCH_PLACE_ALBUMS_REJECTED", payload: err})        
      })
  }
}
