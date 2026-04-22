export default async serverName => {
  console.log('Checking server...')
  console.log('Server:', serverName)
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 500)
    const response = await fetch(serverName + '/api/auth/token/obtain/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'test', password: 'test' }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    // Any response means the server is reachable (200 or 401 etc.)
    return true
  } catch (e) {
    // Network error or timeout — server is not reachable
    return false
  }
}
