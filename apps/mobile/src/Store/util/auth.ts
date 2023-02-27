export function isTokenExpired(exp: number): boolean {
  return 1000 * exp - new Date().getTime() < 5000;
}
