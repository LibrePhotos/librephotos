// This is the default getUrl function, which you can overwrite using a prop;
// <Pig getUrl={(imageHash, pxHeight) => {...}}/>
// Check the readme for more info on what this file does.
export default (imageHash: string, pxHeight: number): string => imageHash.replace("{{HEIGHT}}", String(pxHeight));
