export { default as updateToken } from './UpdateToken'

export function login() {
  return true
}

export function accessToken(authState) {
  if (authState.access) {
    return authState.access.token
  }
}

export function refreshToken(authState) {
  if (authState.refresh) {
    return authState.refresh.token
  }
}

export function isAccessTokenExpired(authState) {
  if (authState.access && authState.access.exp) {
    return 1000 * authState.access.exp - new Date().getTime() < 5000
  }
  return true
}

export function isRefreshTokenExpired(authState) {
  if (authState.refresh && authState.refresh.exp) {
    return 1000 * authState.refresh.exp - new Date().getTime() < 5000
  }
  return true
}

export function isAuthenticated(authState) {
  // return true
  return !isAccessTokenExpired(authState)
}

export function errors(authState) {
  return authState.errors
}
