// https://stackoverflow.com/a/22599173/2255980
let scrollSpeed = ''
let lastPos = 0
let newPos = 0
let delta = 0
let timeout = null

export default function (latestYOffset, scrollThrottleMs, idleCallback) {
  newPos = latestYOffset
  
  if (lastPos !== 0) delta = Math.abs(newPos - lastPos)

  lastPos = newPos
  
  if (delta < 1000) {
    scrollSpeed = 'slow'
  } else if (delta < 3000) {
    scrollSpeed = 'medium'
  } else {
    scrollSpeed = 'fast' // only really happens when user grabs the scrollbar
  }

  // kind of like a reversed debounce, 
  // if this function hasn't been called in a little while, fire the idleCallback function
  clearTimeout(timeout)
  timeout = setTimeout(() => {
    timeout = null
    idleCallback('slow')
  }, scrollThrottleMs * 2)

  return scrollSpeed
}
