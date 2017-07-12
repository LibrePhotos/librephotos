import axios from "axios";


var Server = axios.create({
  baseURL: 'http://localhost:8000/api/',
  timeout: 10000,
  auth: {username: 'admin',
         password: 'skagnfka'}
});

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
            {key:person.id,value:person.name,text:person.name}
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
        var personDropdownOption = {
          name:response.data.name, 
          value:response.data.name, 
          key:response.data.id}
        dispatch({type: "ADD_PERSON_FULFILLED", payload:personDropdownOption})
      })
      .catch((err) => {
        dispatch({type:"ADD_PERSON_REJECTED", payload:err})
      })
  }
}

