export const ZERO = 0;
export function isStringEmpty(value: string): boolean {
  return value.length !== ZERO;
}

export function toUpperCase(value: string): string {
  return value
    .split(" ")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
