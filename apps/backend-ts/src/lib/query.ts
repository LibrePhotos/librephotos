// Query string as Django's request.query_params: repeated keys allowed, get
// returns the LAST value (QueryDict semantics). Port of lp_core::extract.

export class QueryMap {
  constructor(public readonly params: URLSearchParams) {}
  get(key: string): string | undefined {
    const all = this.params.getAll(key);
    return all.length ? all[all.length - 1] : undefined;
  }
  getAll(key: string): string[] {
    return this.params.getAll(key);
  }
  /** Django's `if request.query_params.get(name):` - any non-empty value is true. */
  flag(key: string): boolean {
    const v = this.get(key);
    return v !== undefined && v !== "";
  }
  nonEmpty(key: string): string | undefined {
    const v = this.get(key);
    return v === undefined || v === "" ? undefined : v;
  }
  int(key: string): number | undefined {
    const v = this.nonEmpty(key)?.trim();
    if (v === undefined || !/^[+-]?\d+$/.test(v)) return undefined;
    return Number(v);
  }
}

/** Python truthiness of a parsed JSON value. */
export function pyTruthy(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}
