import axios from "axios";
import Server from '../api_client/apiClient'


export function fetchPeople() {
  return function(dispatch) {
    dispatch({type: "FETCH_PEOPLE"});
    /* 
      http://rest.learncode.academy is a public test server, so another user's experimentation can break your tests
      If you get console errors due to bad data:
      - change "reacttest" below to any other username
      - post some tweets to http://rest.learncode.academy/api/yourusername/tweets
    */
    Server.get("persons/?page_size=1000")
      .then((response) => {
        var mappedPeopleDropdownOptions = response.data.results.map(function(person){
          return (
            {key:person.id,value:person.name,text:person.name,face_url:person.face_url}
          )
        })
        dispatch({type: "FETCH_PEOPLE_FULFILLED", payload: mappedPeopleDropdownOptions})
      })
      .catch((err) => {
        dispatch({type: "FETCH_PEOPLE_REJECTED", payload: err})
      })
  }
}

export function addPerson(person_name) {
  return function(dispatch){
    dispatch({type:"ADD_PERSON"})
    Server.post("persons/",{"name":person_name})
      .then((response) => {
        const personDropdownOption = {
          text:response.data.name, 
          value:response.data.name, 
          key:response.data.id}
        dispatch({type: "ADD_PERSON_FULFILLED", payload:personDropdownOption})
      })
      .catch((err) => {
        dispatch({type:"ADD_PERSON_REJECTED", payload:err})
      })
  }
}


export function addPersonAndSetLabelToFace(person_name,face_id) {
  return function(dispatch){
    dispatch({type:"ADD_PERSON_AND_SET_FACE_LABEL"})
    // Make post request to /persons/
    Server.post("persons/",{"name":person_name})
      .then((response1) => {
        console.log('post /persons/',response1.data)

        var personDropdownOption1 = {
          text: response1.data.name,
          value: response1.data.name,
          key: response1.data.id}
        console.log('result of post',personDropdownOption1)
        // Make patch request to update person label 
        var endpoint = `faces/${face_id}/`
        Server.patch(endpoint,{"person":{"name":person_name}})
          .then((response2) => {
            console.log('patch',endpoint,response2.data)
            var personDropdownOption2 = {
              text: response2.data.person.name,
              value: response2.data.person.name,
              key: response2.data.person.id}
            console.log('result of post',personDropdownOption2)
            dispatch({type: "ADD_PERSON_AND_SET_FACE_LABEL_FULFILLED", payload: personDropdownOption2})
          })
          .catch((err2) => {
            console.log('error in patch',endpoint,err2)
            dispatch({type: "ADD_PERSON_AND_SET_FACE_LABEL_REJECTED", payload: err2})
          })
      })
      .catch((err1) => {
        console.log('error in post',err1)
        dispatch({type:"ADD_PERSON_AND_SET_FACE_LABEL_REJECTED", payload:err1})
      })
  }
}