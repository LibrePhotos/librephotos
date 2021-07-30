export default function ({ message, data, status }) {
  return Promise.reject({ message, data, status })
}
