/**
 * Turn a `data:` URL (a canvas export) into a File for a form upload. The one
 * `fetch` outside the API layer: reading a data URL never touches the network,
 * and anything else is refused so this cannot become a way around src/api_client.
 */
export async function dataUrlToFile(dataUrl: string, filename: string, mimeType?: string): Promise<File> {
  const declared = /^data:([^;,]*)[;,]/.exec(dataUrl);
  if (!declared) {
    throw new Error("dataUrlToFile reads data: URLs only");
  }
  const response = await fetch(dataUrl);
  const bytes = await response.arrayBuffer();
  return new File([bytes], filename, { type: mimeType || declared[1] });
}
