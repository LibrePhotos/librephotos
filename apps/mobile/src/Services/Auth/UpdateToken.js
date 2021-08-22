import AuthUser from '../../Store/Auth/AuthUser'
import api from '../index'
import { store } from '@/Store/index'

function select(state) {
  return state.auth
}

export default async () => {
  const authState = select(store.getState())
  const refreshToken = authState.refresh.token

  const res = await api
    .post('/auth/token/refresh/', {
      refresh: refreshToken,
    })
    .then(response => {
      store.dispatch(AuthUser.action(response.data))
      // return response.data
    })
    .catch(console.log)
  return res
}
