import axios from 'axios'

export default async serverName => {
  // TODO: Create a dedicated endpoint to test connection
  const server = serverName
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
