/** A full page load of `url`. Its own module, so tests can see where the app went. */
export function loadPage(url: string): void {
  window.location.assign(url);
}
