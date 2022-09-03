import { FacesActions } from "../actions/facesActions";

export default function reducer(
  state = {
    fetching: false,
    fetched: false,

    labeledFaces: [],
    fetchingLabeledFaces: false,
    fetchedLabeledFaces: false,

    inferredFaces: [],
    fetchingInferredFaces: false,
    fetchedInferredFaces: false,

    labeledFacesList: [],
    fetchingLabeledFacesList: false,
    fetchedLabeledFacesList: false,

    inferredFacesList: [],
    fetchingInferredFacesList: false,
    fetchedInferredFacesList: false,

    facesVis: [],
    training: false,
    trained: false,

    clustering: false,
    clustered: false,

    error: null,
  },
  action
) {
  let newInferredFacesList;
  let newLabeledFacesList;
  switch (action.type) {
    // labeled faces
    case "FETCH_LABELED_FACES": {
      return { ...state, fetchingLabeledFaces: true };
    }
    case "FETCH_LABELED_FACES_REJECTED": {
      return { ...state, fetchingLabeledFaces: false, error: action.payload };
    }
    case "FETCH_LABELED_FACES_FULFILLED": {
      return {
        ...state,
        fetchingLabeledFaces: false,
        fetchedLabeledFaces: true,
        labeledFaces: action.payload,
      };
    }

    // inferred faces
    case "FETCH_INFERRED_FACES": {
      return { ...state, fetchingInferredFaces: true };
    }
    case "FETCH_INFERRED_FACES_REJECTED": {
      return { ...state, fetchingInferredFaces: false, error: action.payload };
    }
    case "FETCH_INFERRED_FACES_FULFILLED": {
      return {
        ...state,
        fetchingInferredFaces: false,
        fetchedInferredFaces: true,
        inferredFaces: action.payload,
      };
    }
    // fetch faces
    case FacesActions.FETCH_FACES: {
      return { ...state, fetching: true };
    }
    case FacesActions.FETCH_FACES_REJECECTED: {
      return { ...state, fetching: false, error: action.payload };
    }
    case FacesActions.FETCH_FACES_FULFILLED: {
      const inferred = action.payload.inferred;
      var personListToChange = inferred ? [...state.inferredFacesList] : [...state.labeledFacesList];
      const personId = action.payload.person;
      const indexToReplace = personListToChange.findIndex(person => person.id === personId);
      const personToChange = personListToChange[indexToReplace];
      const currentFaces = personToChange.faces;
      const newFaces = action.payload.faces;
      const updatedFaces = currentFaces
        .slice(0, (action.payload.page - 1) * 100)
        .concat(newFaces)
        .concat(currentFaces.slice(action.payload.page * 100));
      personToChange.faces = updatedFaces;
      personListToChange[indexToReplace] = personToChange;
      if (inferred) {
        return {
          ...state,
          inferredFacesList: personListToChange,
        };
      } else {
        return {
          ...state,
          labeledFacesList: personListToChange,
        };
      }
    }

    // labeled faces
    case FacesActions.FETCH_LABELED_FACES_LIST: {
      return { ...state, fetchingLabeledFacesList: true };
    }
    case FacesActions.FETCH_LABELED_FACES_LIST_REJECTED: {
      return {
        ...state,
        fetchingLabeledFacesList: false,
        error: action.payload,
      };
    }
    case FacesActions.FETCH_LABELED_FACES_LIST_FULFILLED: {
      const newFacesList = action.payload.map(person => {
        person.faces = [];
        for (let i = 0; i < person.face_count; i++) {
          person.faces.push({
            id: i,
            person: person.id,
            isTemp: true,
          });
        }
        return person;
      });
      return {
        ...state,
        fetchingLabeledFacesList: false,
        fetchedLabeledFacesList: true,
        labeledFacesList: newFacesList,
      };
    }

    // inferred faces
    case FacesActions.FETCH_INFERRED_FACES_LIST: {
      return { ...state, fetchingInferredFacesList: true };
    }
    case FacesActions.FETCH_INFERRED_FACES_LIST_REJECTED: {
      return {
        ...state,
        fetchingInferredFacesList: false,
        error: action.payload,
      };
    }
    case FacesActions.FETCH_INFERRED_FACES_LIST_FULFILLED: {
      // for each person add faces with empty attributes
      const newFacesList = action.payload.map(person => {
        person.faces = [];
        for (let i = 0; i < person.face_count; i++) {
          person.faces.push({
            id: i,
            person: person.id,
            isTemp: true,
          });
        }
        return person;
      });

      return {
        ...state,
        fetchingInferredFacesList: false,
        fetchedInferredFacesList: true,
        inferredFacesList: newFacesList,
      };
    }
    // mass labeling faces
    case FacesActions.SET_FACES_PERSON_LABEL_FULFILLED: {
      const facesToRemove = action.payload.results;
      const facesToAdd = action.payload.results;
      const newLabeledFacesList = [...state.labeledFacesList];
      const newInferredFacesList = [...state.inferredFacesList];
      facesToRemove.forEach(face => {
        // find the person by finding the face and remove the face from it and update the list
        const personToChange = newLabeledFacesList.find(
          person => person.faces.filter(i => i.face_url == face.face_url).length > 0
        );
        if (personToChange) {
          const indexToRemove = personToChange.faces.findIndex(f => f.id === face.id);
          personToChange.faces.splice(indexToRemove, 1);
          const indexToReplace = newLabeledFacesList.findIndex(person => person.id === personToChange.id);
          if (personToChange.faces.length === 0) {
            newLabeledFacesList.splice(indexToReplace, 1);
          } else {
            newLabeledFacesList[indexToReplace] = personToChange;
          }
        }
        // same thing for inferred
        const personToChangeInferred = newInferredFacesList.find(
          person => person.faces.filter(i => i.face_url == face.face_url).length > 0
        );
        if (personToChangeInferred) {
          const indexToRemoveInferred = personToChangeInferred.faces.findIndex(f => f.id === face.id);
          personToChangeInferred.faces.splice(indexToRemoveInferred, 1);
          const indexToReplaceInferred = newInferredFacesList.findIndex(
            person => person.id === personToChangeInferred.id
          );
          if (personToChangeInferred.faces.length === 0) {
            newInferredFacesList.splice(indexToReplaceInferred, 1);
          } else {
            newInferredFacesList[indexToReplaceInferred] = personToChangeInferred;
          }
        }
      });

      facesToAdd.forEach(face => {
        // find the person and add the face to it and update the list
        const personToChange = newLabeledFacesList.find(person => person.id === face.person);
        if (personToChange) {
          personToChange.faces.push(face);
          const indexToReplace = newLabeledFacesList.findIndex(person => person.id === face.person);
          newLabeledFacesList[indexToReplace] = personToChange;
        } else {
          // add new person and new face
          const newPerson = {
            id: face.person,
            name: face.person_name,
            faces: [
              {
                id: face.id,
                face_url: face.face_url,
                image: face.image,
                person_label_probability: 1,
                photo: face.photo,
              },
            ],
          };
          newLabeledFacesList.push(newPerson);
        }
      });

      // sort both lists by name
      newLabeledFacesList.sort((a, b) => {
        if (a.name < b.name) {
          return -1;
        }
        if (a.name > b.name) {
          return 1;
        }
        return 0;
      });
      newInferredFacesList.sort((a, b) => {
        if (a.name < b.name) {
          return -1;
        }
        if (a.name > b.name) {
          return 1;
        }
        return 0;
      });

      return {
        ...state,
        inferredFacesList: newInferredFacesList,
        labeledFacesList: newLabeledFacesList,
      };
    }

    // mass labeling faces
    case FacesActions.DELETE_FACES_FULFILLED: {
      const facesToRemove = action.payload;
      console.log(facesToRemove);
      const newLabeledFacesList = [...state.labeledFacesList];
      const newInferredFacesList = [...state.inferredFacesList];
      facesToRemove.forEach(face => {
        // find the person by finding the face and remove the face from it and update the list
        const personToChange = newLabeledFacesList.find(
          person => person.faces.filter(i => i.face_url == face).length > 0
        );
        console.log(personToChange);
        if (personToChange) {
          const indexToRemove = personToChange.faces.findIndex(f => f.face_url === face);
          personToChange.faces.splice(indexToRemove, 1);
          const indexToReplace = newLabeledFacesList.findIndex(person => person.id === personToChange.id);
          if (personToChange.faces.length === 0) {
            newLabeledFacesList.splice(indexToReplace, 1);
          } else {
            newLabeledFacesList[indexToReplace] = personToChange;
          }
        }
        // same thing for inferred
        const personToChangeInferred = newInferredFacesList.find(
          person => person.faces.filter(i => i.face_url == face).length > 0
        );
        if (personToChangeInferred) {
          const indexToRemoveInferred = personToChangeInferred.faces.findIndex(f => f.face_url === face);
          personToChangeInferred.faces.splice(indexToRemoveInferred, 1);
          const indexToReplaceInferred = newInferredFacesList.findIndex(
            person => person.id === personToChangeInferred.id
          );
          if (personToChangeInferred.faces.length === 0) {
            newInferredFacesList.splice(indexToReplaceInferred, 1);
          } else {
            newInferredFacesList[indexToReplaceInferred] = personToChangeInferred;
          }
        }
      });
      return {
        ...state,
        inferredFacesList: newInferredFacesList,
        labeledFacesList: newLabeledFacesList,
      };
    }

    // train faces
    case FacesActions.TRAIN_FACES: {
      return { ...state, training: true };
    }
    case FacesActions.TRAIN_FACES_REJECTED: {
      return { ...state, training: false, error: action.payload };
    }
    case FacesActions.TRAIN_FACES_FULFILLED: {
      return {
        ...state,
        training: false,
        trained: true,
        facesVis: action.payload,
      };
    }

    // train faces
    case FacesActions.CLUSTER_FACES: {
      return { ...state, clustering: true };
    }
    case FacesActions.CLUSTER_FACES_REJECTED: {
      return { ...state, clustering: false, error: action.payload };
    }
    case FacesActions.CLUSTER_FACES_FULFILLED: {
      return {
        ...state,
        clustering: false,
        clustered: true,
        facesVis: action.payload,
      };
    }
    default: {
      return { ...state };
    }
  }
}
