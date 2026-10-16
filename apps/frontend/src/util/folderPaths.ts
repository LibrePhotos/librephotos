/** Paths as the server sends them, which on Windows may mix `\` and `/`. */

const trimmed = (path: string) => path.replace(/[\\/]+$/, "");

/** A drive-letter (`C:`) or share (`\\host`) path, whose separators are `\` and `/` alike. */
const WINDOWS_PATH = /^(?:[A-Za-z]:|\\\\)/;

/** A path in the form two spellings of it compare equal: no trailing separator, `/` on Windows. */
const comparable = (path: string): string => {
  const bare = trimmed(path);
  return WINDOWS_PATH.test(bare) ? bare.replaceAll("\\", "/").toLowerCase() : bare;
};

/** Whether two server paths name one folder: a trailing separator and, on Windows, the separator and case aside. */
export const samePath = (a: string, b: string): boolean => comparable(a) === comparable(b);

/** The folder a file path is in. */
export function parentFolder(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut <= 0 ? path.slice(0, cut + 1) : path.slice(0, cut);
}

/** `name` inside `parent`, joined with the separator the server's path uses. */
export function childPath(parent: string, name: string): string {
  const separator = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return `${trimmed(parent)}${separator}${name.trim()}`;
}

/** The last part of a server path, the folder's own name. */
export const folderName = (path: string): string => path.split(/[\\/]/).findLast(part => part !== "") ?? path;
