// request.data for the user endpoints: JSON, multipart (avatar upload) or a
// urlencoded form, parsed only after authorization like DRF does. Port of
// lp_api::users_settings::input.
import { ApiError } from "~/lib/errors";

export interface UploadedFile {
  filename: string;
  bytes: Uint8Array;
}

export type InputValue = { value: unknown } | { file: UploadedFile };

export interface Input {
  fields: Map<string, InputValue>;
  /** Form input (multipart / urlencoded): JSON fields arrive as strings. */
  html: boolean;
}

function pyTypeName(v: unknown): string {
  if (Array.isArray(v)) return "list";
  if (typeof v === "string") return "str";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
  if (typeof v === "boolean") return "bool";
  if (v === null) return "NoneType";
  return "dict";
}

export async function readInput(req: Request): Promise<Input> {
  const ctype = (req.headers.get("content-type") ?? "").toLowerCase();
  if (ctype.startsWith("multipart/form-data")) {
    let fd: FormData;
    try {
      fd = await req.formData();
    } catch (e) {
      throw ApiError.badRequest("detail", `Multipart form parse error - ${(e as Error).message}`);
    }
    const fields = new Map<string, InputValue>();
    for (const [k, v] of fd.entries()) {
      if (typeof v === "string") fields.set(k, { value: v });
      else fields.set(k, { file: { filename: (v as File).name ?? "", bytes: new Uint8Array(await (v as File).arrayBuffer()) } });
    }
    return { fields, html: true };
  }
  const body = await req.text();
  if (ctype.startsWith("application/x-www-form-urlencoded")) {
    const fields = new Map<string, InputValue>();
    for (const [k, v] of new URLSearchParams(body)) fields.set(k, { value: v });
    return { fields, html: true };
  }
  if (ctype && !ctype.startsWith("application/json") && body.length) {
    const shown = ctype.split(";")[0].trim();
    throw ApiError.of(415, "detail", `Unsupported media type "${shown}" in request.`);
  }
  if (!body.length) return { fields: new Map(), html: false };
  let v: unknown;
  try {
    v = JSON.parse(body);
  } catch (e) {
    throw ApiError.badRequest("detail", `JSON parse error - ${(e as Error).message}`);
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw ApiError.validation(`Invalid data. Expected a dictionary, but got ${pyTypeName(v)}.`);
  }
  return { fields: new Map(Object.entries(v).map(([k, x]) => [k, { value: x }])), html: false };
}
