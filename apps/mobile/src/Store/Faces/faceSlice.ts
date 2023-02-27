import { createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'

import { api } from '../api'
import { FacesOrderOption, FacesTab } from './facesActions.types'
import type {
  ICompletePersonFace,
  ICompletePersonFaceList,
  IFacesOrderOption,
  IFacesState,
  IFacesTab,
  ITabSettingsArray,
  IPersonFace,
} from './facesActions.types'

const initialState: IFacesState = {
  labeledFacesList: [] as ICompletePersonFaceList,
  inferredFacesList: [] as ICompletePersonFaceList,
  facesVis: [],
  training: false,
  trained: false,
  clustering: false,
  clustered: false,
  orderBy: FacesOrderOption.enum.confidence,
  error: null,
  activeTab: FacesTab.enum.labeled,
  tabs: {
    labeled: { scrollPosition: 0 },
    inferred: { scrollPosition: 0 },
  } as ITabSettingsArray,
}

const compareFacesConfidence = (a: IPersonFace, b: IPersonFace) => {
  if (a.person_label_probability > b.person_label_probability) return -1
  if (a.person_label_probability < b.person_label_probability) return 1
  if (a.id < b.id) return -1
  if (a.id > b.id) return 1
  return 0
}

const compareFacesDate = (a: IPersonFace, b: IPersonFace) => {
  const dateA = new Date(a.timestamp || '')
  const dateB = new Date(b.timestamp || '')
  if (
    dateA.toString() === 'Invalid Date' &&
    dateB.toString() === 'Invalid Date'
  )
    return compareFacesConfidence(a, b)
  if (dateA.toString() === 'Invalid Date') return 1
  if (dateB.toString() === 'Invalid Date') return -1
  if (dateA < dateB) return -1
  if (dateA > dateB) return 1
  return compareFacesConfidence(a, b)
}

const sortFaces = (faces, order: IFacesOrderOption) => {
  if (order === FacesOrderOption.enum.confidence)
    faces.sort((a: IPersonFace, b: IPersonFace) => compareFacesConfidence(a, b))
  else if (order === FacesOrderOption.enum.date)
    faces.sort((a: IPersonFace, b: IPersonFace) => compareFacesDate(a, b))
}

const clearPersonFacesIfNeeded = (person: ICompletePersonFace) => {
  let needClear: boolean = false
  let personHasAlreadyLoadedFaces: boolean = false
  person.faces.every((face: IPersonFace) => {
    if (!personHasAlreadyLoadedFaces && face.image != null) {
      personHasAlreadyLoadedFaces = true
    }
    if (personHasAlreadyLoadedFaces && face.image == null) {
      needClear = true
      return false
    }
    return true
  })
  if (needClear) {
    for (let i = 0; i < person.faces.length; i += 1) {
      if (person.faces[i].image !== null) {
        // eslint-disable-next-line no-param-reassign
        person.faces[i] = {
          id: i,
          image: null,
          face_url: null,
          photo: '',
          person_label_probability: 1,
          person: person.id,
          isTemp: true,
        }
      }
    }
  }
}

const faceSlice = createSlice({
  name: 'face',
  initialState: initialState,
  reducers: {
    changeTab: (state, action: PayloadAction<IFacesTab>) => ({
      ...state,
      activeTab: action.payload,
    }),
    saveCurrentGridPosition: (
      state,
      action: PayloadAction<{ tab: IFacesTab; position: number }>,
    ) => {
      const { tab, position } = action.payload
      if (tab in state.tabs) {
        // @ts-ignore
        state.tabs[tab].scrollPosition = position
      }
    },
    changeFacesOrderBy: (state, action: PayloadAction<IFacesOrderOption>) => {
      // eslint-disable-next-line no-param-reassign
      state.orderBy = action.payload
      // If element contains some incomplete faces, we need to clear all faces
      state.labeledFacesList.forEach(element =>
        clearPersonFacesIfNeeded(element),
      )
      state.inferredFacesList.forEach(element =>
        clearPersonFacesIfNeeded(element),
      )
      // Sort both lists according to new criteria
      state.labeledFacesList.forEach(element => {
        sortFaces(element.faces, state.orderBy)
      })
      state.inferredFacesList.forEach(element => {
        sortFaces(element.faces, state.orderBy)
      })
    },
  },
  extraReducers: builder => {
    builder
      .addMatcher(
        api.endpoints.fetchIncompleteFaces.matchFulfilled,
        (state, { meta, payload }) => {
          const newFacesList: ICompletePersonFaceList = payload.map(person => {
            const completePersonFace: ICompletePersonFace = {
              ...person,
              faces: [],
            }
            for (let i = 0; i < person.face_count; i += 1) {
              completePersonFace.faces.push({
                id: i,
                image: null,
                face_url: null,
                photo: '',
                person_label_probability: 1,
                person: person.id,
                isTemp: true,
              })
            }
            return completePersonFace
          })
          return {
            ...state,
            labeledFacesList: !meta.arg.originalArgs.inferred
              ? newFacesList
              : state.labeledFacesList,
            inferredFacesList: meta.arg.originalArgs.inferred
              ? newFacesList
              : state.inferredFacesList,
          }
        },
      )
      .addMatcher(
        api.endpoints.fetchFaces.matchFulfilled,
        (state, { meta, payload }) => {
          // eslint-disable-next-line prefer-destructuring
          const inferred = meta.arg.originalArgs.inferred
          const personListToChange = inferred
            ? state.inferredFacesList
            : state.labeledFacesList
          const personId = meta.arg.originalArgs.person
          const indexToReplace = personListToChange.findIndex(
            person => person.id === personId,
          )
          if (indexToReplace !== -1) {
            const personToChange = personListToChange[indexToReplace]
            const currentFaces = personToChange.faces
            // @ts-ignore
            const newFaces = payload.results

            const updatedFaces = currentFaces
              .slice(0, (meta.arg.originalArgs.page - 1) * 100)
              .concat(newFaces)
              .concat(currentFaces.slice(meta.arg.originalArgs.page * 100))

            personToChange.faces = updatedFaces
            personListToChange[indexToReplace] = personToChange
          }
        },
      )
      //@ts-ignore
      .addMatcher(
        api.endpoints.clusterFaces.matchFulfilled,
        (state, { payload }) => {
          return {
            ...state,
            facesVis: payload,
            clustered: true,
          }
        },
      )
      //@ts-ignore
      .addMatcher(
        api.endpoints.trainFaces.matchFulfilled,
        (state, { payload }) => {
          return {
            ...state,
            training: false,
            trained: true,
            facesVis: payload,
          }
        },
      )
      .addMatcher(
        api.endpoints.deleteFaces.matchFulfilled,
        (state, { meta, payload }) => {
          const facesToRemove = payload.results
          const newLabeledFacesList = state.labeledFacesList
          const newInferredFacesList = state.inferredFacesList
          facesToRemove.forEach(face => {
            // find the person by finding the face and remove the face from it and update the list
            const personToChange = newLabeledFacesList.find(
              person =>
                person.faces.filter(i => i.face_url === face).length > 0,
            )
            if (personToChange) {
              const indexToRemove = personToChange.faces.findIndex(
                f => f.face_url === face,
              )
              personToChange.faces.splice(indexToRemove, 1)
              const indexToReplace = newLabeledFacesList.findIndex(
                person => person.id === personToChange.id,
              )
              if (personToChange.faces.length === 0) {
                newLabeledFacesList.splice(indexToReplace, 1)
              } else {
                newLabeledFacesList[indexToReplace] = personToChange
              }
              personToChange.face_count = personToChange.faces.length
            }
            // same thing for inferred
            const personToChangeInferred = newInferredFacesList.find(
              person => person.faces.filter(i => i.face_url == face).length > 0,
            )
            if (personToChangeInferred) {
              const indexToRemoveInferred =
                personToChangeInferred.faces.findIndex(f => f.face_url === face)
              personToChangeInferred.faces.splice(indexToRemoveInferred, 1)
              const indexToReplaceInferred = newInferredFacesList.findIndex(
                person => person.id === personToChangeInferred.id,
              )
              if (personToChangeInferred.faces.length === 0) {
                newInferredFacesList.splice(indexToReplaceInferred, 1)
              } else {
                newInferredFacesList[indexToReplaceInferred] =
                  personToChangeInferred
              }
              personToChangeInferred.face_count =
                personToChangeInferred.faces.length
            }
          })
        },
      )
      .addMatcher(
        api.endpoints.setFacesPersonLabel.matchFulfilled,
        (state, { meta, payload }) => {
          const facesToRemove = payload.results
          const facesToAdd = payload.results
          const newLabeledFacesList = state.labeledFacesList
          const newInferredFacesList = state.inferredFacesList
          facesToRemove.forEach(face => {
            // find the person by finding the face and remove the face from it and update the list
            const personToChange = newLabeledFacesList.find(
              person =>
                person.faces.filter(i => i.face_url === face.face_url).length >
                0,
            )
            if (personToChange) {
              const indexToRemove = personToChange.faces.findIndex(
                f => f.id === face.id,
              )
              personToChange.faces.splice(indexToRemove, 1)
              const indexToReplace = newLabeledFacesList.findIndex(
                person => person.id === personToChange.id,
              )
              if (personToChange.faces.length === 0) {
                newLabeledFacesList.splice(indexToReplace, 1)
              } else {
                newLabeledFacesList[indexToReplace] = personToChange
              }
              personToChange.face_count = personToChange.faces.length
            }
            // same thing for inferred
            const personToChangeInferred = newInferredFacesList.find(
              person =>
                person.faces.filter(i => i.face_url === face.face_url).length >
                0,
            )
            if (personToChangeInferred) {
              const indexToRemoveInferred =
                personToChangeInferred.faces.findIndex(f => f.id === face.id)
              personToChangeInferred.faces.splice(indexToRemoveInferred, 1)
              const indexToReplaceInferred = newInferredFacesList.findIndex(
                person => person.id === personToChangeInferred.id,
              )
              if (personToChangeInferred.faces.length === 0) {
                newInferredFacesList.splice(indexToReplaceInferred, 1)
              } else {
                newInferredFacesList[indexToReplaceInferred] =
                  personToChangeInferred
              }
              personToChangeInferred.face_count =
                personToChangeInferred.faces.length
            }
          })

          facesToAdd.forEach(face => {
            // find the person and add the face to it and update the list
            const personToChange = newLabeledFacesList.find(
              person => person.id === face.person,
            )
            if (personToChange) {
              personToChange.faces.push(face)
              personToChange.face_count = personToChange.faces.length
              const indexToReplace = newLabeledFacesList.findIndex(
                person => person.id === face.person,
              )
              newLabeledFacesList[indexToReplace] = personToChange
            } else if (face.person && face.person_name) {
              // add new person and new face
              const newPerson: ICompletePersonFace = {
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
                kind: 'USER',
                face_count: 1,
              }
              newLabeledFacesList.push(newPerson)
            }
          })

          // sort both lists by name
          newLabeledFacesList.sort((a, b) => {
            if (a.name.toLowerCase() < b.name.toLowerCase()) {
              return -1
            }
            if (a.name.toLowerCase() > b.name.toLowerCase()) {
              return 1
            }
            return 0
          })
          newInferredFacesList.sort((a, b) => {
            if (a.name.toLowerCase() < b.name.toLowerCase()) {
              return -1
            }
            if (a.name.toLowerCase() > b.name.toLowerCase()) {
              return 1
            }
            return 0
          })
        },
      )
      .addDefaultCase(state => state)
  },
})

export const { reducer: faceReducer, actions: faceActions } = faceSlice
