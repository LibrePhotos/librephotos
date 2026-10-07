// DRF PageNumberPagination envelope {count, next, previous, results} with
// absolute next/previous URLs built like DRF's replace_query_param /
// remove_query_param (keys sorted, + for spaces). Port of lp_api::common::pagination.
import { ApiError } from "./errors";
import type { QueryMap } from "./query";

export interface PageRequest {
  /** 1-based; Infinity = "last" until resolved by validFor. */
  page: number;
  pageSize: number;
}

/** page (default 1; "last" allowed), page size capped at maxSize. */
export function pageRequest(q: QueryMap, sizeParam: string, defaultSize: number, maxSize: number): PageRequest {
  const raw = q.nonEmpty("page");
  let page = 1;
  if (raw === "last") page = Infinity;
  else if (raw !== undefined) {
    if (!/^\d+$/.test(raw.trim()) || Number(raw) < 1) throw ApiError.notFound("Invalid page.");
    page = Number(raw);
  }
  const s = q.int(sizeParam);
  return { page, pageSize: s !== undefined && s > 0 ? Math.min(s, maxSize) : defaultSize };
}

export const numPages = (r: PageRequest, count: number) => (count === 0 ? 1 : Math.ceil(count / r.pageSize));

/** Resolves "last" and rejects pages past the end (DRF: 404 "Invalid page."). */
export function validFor(r: PageRequest, count: number): PageRequest {
  const n = numPages(r, count);
  const page = r.page === Infinity ? n : r.page;
  if (page > n) throw ApiError.notFound("Invalid page.");
  return { ...r, page };
}

export const offset = (r: PageRequest) => (r.page - 1) * r.pageSize;

/** request.build_absolute_uri() (http unless X-Forwarded-Proto: https). */
export function absoluteUri(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost";
  const scheme = req.headers.get("x-forwarded-proto") === "https" ? "https" : "http";
  return `${scheme}://${host}${url.pathname}${url.search}`;
}

function formEncode(s: string) {
  return encodeURIComponent(s).replace(/%20/g, "+").replace(/[!'()*~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function withQuery(url: string, key: string, value: string | null): string {
  const i = url.indexOf("?");
  const base = i < 0 ? url : url.slice(0, i);
  const pairs = [...new URLSearchParams(i < 0 ? "" : url.slice(i + 1)).entries()].filter(([k]) => k !== key);
  if (value !== null) pairs.push([key, value]);
  pairs.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  const q = pairs.map(([k, v]) => `${formEncode(k)}=${formEncode(v)}`).join("&");
  return q ? `${base}?${q}` : base;
}

/**
 * DRF get_next_link / get_previous_link for the current request. Every
 * Django list URL ends in a slash, so the links get it back.
 */
export function pageLinks(req: Request, page: number, pages: number): { next: string | null; previous: string | null } {
  let url = absoluteUri(req);
  const end = url.indexOf("?") < 0 ? url.length : url.indexOf("?");
  if (!url.slice(0, end).endsWith("/")) url = url.slice(0, end) + "/" + url.slice(end);
  return {
    next: page < pages ? withQuery(url, "page", String(page + 1)) : null,
    previous: page > 1 ? (page - 1 === 1 ? withQuery(url, "page", null) : withQuery(url, "page", String(page - 1))) : null,
  };
}

export function drfPage<T>(req: Request, r: PageRequest, count: number, results: T[]) {
  const { next, previous } = pageLinks(req, r.page, numPages(r, count));
  return { count, next, previous, results };
}
