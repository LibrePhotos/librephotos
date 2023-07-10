// This is the default getUrl function, which you can overwrite using a prop;
// <Pig getUrl={(url, pxHeight) => {...}}/>
// Check the readme for more info on what this file does.
export default (url, pxHeight) => url.replace('{{HEIGHT}}', pxHeight)
