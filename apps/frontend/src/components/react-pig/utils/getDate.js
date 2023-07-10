// https://stackoverflow.com/a/34015511/2255980
const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };

export default str => {
  const asDate = new Date(str)
  return asDate.toLocaleDateString('en-US', options)
}
