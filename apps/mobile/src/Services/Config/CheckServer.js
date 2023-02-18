import axios from 'axios'

export const preprocessserver = server => {
  let serverName = server.trim().toLowerCase()

  if (!serverName.startsWith('http://') && !serverName.startsWith('https://')) {
    serverName = 'http://' + serverName
  }

  if (serverName.endsWith('/')) {
    serverName = serverName.substring(0, serverName.length - 1)
  }
  return serverName
}

export default async serverName => {
  // TODO: Create a dedicated endpoint to test connection
  const server = preprocessserver(serverName)
  const res = await axios
    .post(
      server + '/api/auth/token/obtain/',
      {
        username: 'test',
        password: 'test',
      },
      {
        timeout: 500,
      },
    )
    .then(response => {
      return true
    })
    .catch(e => {
      return typeof e.response !== 'undefined' && e.response.status === 401
    })

  return res
}
