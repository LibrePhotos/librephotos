/**
 * A thing's or tag's name as a collection card shows it: first letter upper case ("Street art"),
 * so the tagger's lower-case words sit well next to Title Case albums. Display only: links,
 * search and sorting keep the stored word.
 */
export function cardTitle(name: string): string {
  return name.charAt(0).toLocaleUpperCase() + name.slice(1);
}
