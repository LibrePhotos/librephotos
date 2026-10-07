// PersonViewSet (/api/persons/): the people page list and the rename / cover /
// delete actions on one person (port of lp_api::people_faces::persons). The
// queryset is the requester's user-labelled persons, so anyone else's person
// (or a cluster) is a 404.
import { ApiError, type FieldError } from "~/lib/errors";
import { json, jsonBody } from "~/lib/http";
import { drfPage, offset, pageRequest, validFor } from "~/lib/pagination";
import type { QueryMap } from "~/lib/query";
import { siteSettings } from "~/lib/settings";
import type { User } from "~/lib/users";
import * as dbq from "./db";
import type { PersonRow } from "./db";
import { pyInt } from "./common";
import * as write from "./write";

/** PersonSerializer read fields, in its field order. */
function personOut(r: PersonRow) {
  let faceUrl: string;
  if (r.cover_face_id !== null) faceUrl = `/media/${r.cover_face_image ?? ""}`;
  else faceUrl = r.first_face_image ? `/media/${r.first_face_image}` : "";
  const [hash, video] =
    r.cover_photo_hash !== null
      ? [r.cover_photo_hash, r.cover_photo_video ?? false]
      : [r.first_face_photo_hash ?? "", r.first_face_photo_video ?? false];
  // Django answers video "False" for a person without faces on the
  // requester's photos; the frontend schema wants a boolean.
  return { name: r.name, face_url: faceUrl, face_count: r.face_count, face_photo_url: hash, video, id: r.id };
}

/**
 * DRF search_smart_split: whitespace-separated terms (quotes keep a phrase
 * together), each further split on commas.
 */
export function searchTerms(search: string): string[] {
  const chars = [...search.replace(/\0/g, "")];
  const terms: string[] = [];
  let i = 0;
  const ws = (c: string) => /\s/u.test(c);
  while (i < chars.length) {
    while (i < chars.length && ws(chars[i])) i++;
    let term = "";
    let quote: string | null = null;
    while (i < chars.length) {
      const c = chars[i];
      if (quote === null && ws(c)) break;
      i++;
      if (quote !== null && c === quote) quote = null;
      else if (quote === null && (c === '"' || c === "'")) quote = c;
      term += c;
    }
    term = term.replace(/^,+|,+$/g, "");
    if (!term) continue;
    const first = term[0];
    if ((first === '"' || first === "'") && [...term].length > 1 && term.endsWith(first)) terms.push(term.slice(1, -1));
    else for (const s of term.split(",")) if (s) terms.push(s.trim());
  }
  return terms;
}

const searchOf = (q: QueryMap) => {
  const s = q.get("search");
  return s === undefined ? [] : searchTerms(s);
};

/** GET /api/persons/?page_size=1000 (StandardResultsSetPagination: 1000, page_size up to 2000), by name. */
export async function listPersons(user: User, q: QueryMap, req: Request) {
  const search = searchOf(q);
  let pr = pageRequest(q, "page_size", 1000, 2000);
  let results: PersonRow[] = [];
  let count: number;
  if (pr.page === Infinity) {
    count = await dbq.countPersons(user.id, search);
    pr = validFor(pr, count);
    results = await dbq.listPersons(user.id, search, pr.pageSize, offset(pr));
  } else {
    const page = await dbq.listPersons(user.id, search, pr.pageSize, offset(pr));
    if (page.length) {
      count = page[0].total;
      results = page;
    } else {
      count = await dbq.countPersons(user.id, search);
      pr = validFor(pr, count);
    }
  }
  return drfPage(req, pr, count, results.map(personOut));
}

/** get_object(), which runs the list's filters (?search=) as well. */
async function load(userId: number, id: string, q: QueryMap): Promise<PersonRow> {
  // DRF's get_object_or_404 turns a lookup ValueError into a bare Http404.
  const n = /^[+-]?\d+$/.test(id) ? BigInt(id) : null;
  if (n === null || n > 9223372036854775807n || n < -9223372036854775808n) throw ApiError.notFound();
  const p = await dbq.personForOwner(userId, n, searchOf(q));
  if (!p) throw ApiError.notFound("No Person matches the given query.");
  return p;
}

/** GET /api/persons/{id}/ */
export async function retrievePerson(user: User, id: string, q: QueryMap) {
  return personOut(await load(user.id, id, q));
}

/** DRF CharField(max_length) input rules (trimmed, not blank, not null). */
function drfChar(v: unknown, maxLength: number): string | { error: string } {
  let text: string;
  if (v === null) return { error: "This field may not be null." };
  if (typeof v === "string") text = v;
  else if (typeof v === "number") text = String(v);
  else return { error: "Not a valid string." };
  text = text.trim();
  if (!text) return { error: "This field may not be blank." };
  if ([...text].length > maxLength) return { error: `Ensure this field has no more than ${maxLength} characters.` };
  return text;
}

const INT_MIN = -2147483648n;
const INT_MAX = 2147483647n;

/** DRF IntegerField from the model's IntegerField, with Postgres' int4 range validators. */
function drfInt(v: unknown): bigint | { error: string } {
  const INVALID = "A valid integer is required.";
  let text: string;
  if (v === null) return { error: "This field may not be null." };
  if (typeof v === "number") text = String(v);
  else if (typeof v === "string") {
    if (v.length > 1000) return { error: "String value too large." };
    text = v;
  } else return { error: INVALID };
  // int(re.sub(r"\.0*\s*$", "", str(data)))
  text = text.replace(/\.0*\s*$/, "");
  const n = pyInt(text);
  if (n === null) return { error: INVALID };
  if (n > INT_MAX) return { error: `Ensure this value is less than or equal to ${INT_MAX}.` };
  if (n < INT_MIN) return { error: `Ensure this value is greater than or equal to ${INT_MIN}.` };
  return n;
}

function pyTypeName(v: unknown): string {
  if (v === null) return "NoneType";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
  if (typeof v === "string") return "str";
  if (Array.isArray(v)) return "list";
  return "dict";
}

interface PersonInput {
  name?: string;
  newName?: string;
  cover?: string;
}

/** serializer.is_valid(), errors in the serializer's field order. Without partial (PUT, POST) name is required. */
function validate(body: unknown, partial: boolean): PersonInput {
  if (body === null || typeof body !== "object" || Array.isArray(body))
    throw ApiError.validation(`Invalid data. Expected a dictionary, but got ${pyTypeName(body)}.`);
  const fields = body as Record<string, unknown>;
  const errors: FieldError[] = [];
  const out: PersonInput = {};
  const check = <T>(key: string, r: T | { error: string } | undefined): T | undefined => {
    if (r === undefined) return undefined;
    if (typeof r === "object" && r !== null && "error" in (r as object)) {
      errors.push({ field: key, message: (r as { error: string }).error });
      return undefined;
    }
    return r as T;
  };
  const has = (k: string) => Object.prototype.hasOwnProperty.call(fields, k);
  if (!has("name") && !partial) errors.push({ field: "name", message: "This field is required." });
  else out.name = check<string>("name", has("name") ? drfChar(fields.name, 128) : undefined);
  check<bigint>("face_count", has("face_count") ? drfInt(fields.face_count) : undefined);
  out.newName = check<string>("newPersonName", has("newPersonName") ? drfChar(fields.newPersonName, 100) : undefined);
  out.cover = check<string>("cover_photo", has("cover_photo") ? drfChar(fields.cover_photo, 100) : undefined);
  if (errors.length) throw ApiError.fields(400, errors);
  return out;
}

/**
 * PATCH (partial) / PUT /api/persons/{id}/: {newPersonName} renames,
 * {cover_photo} (an image hash or a photo id of the requester's own) sets the
 * cover (PATCH only: Django's update returns after the rename). Django also
 * fills an absent newPersonName with its "" default on PUT and blanks the
 * name; here the name is then left alone (as Rust).
 */
export async function savePerson(user: User, id: string, q: QueryMap, request: Request, partial: boolean) {
  const person = await load(user.id, id, q);
  const input = validate(await jsonBody<unknown>(request), partial);
  if (input.newName !== undefined) {
    const { TAGGING_MODEL } = await siteSettings();
    await write.renamePerson(person.id, input.newName, TAGGING_MODEL);
  } else if (input.cover !== undefined && partial) {
    const photo = await dbq.ownedPhotoByHashOrId(user.id, input.cover);
    if (!photo) throw ApiError.badRequest("cover_photo", `Photo not found: ${input.cover}`);
    await write.setPersonCover(person.id, photo);
  } else return personOut(person);
  return personOut(await load(user.id, id, q));
}

/** POST /api/persons/ {name}: the requester's person of that name (any kind), else a new USER one; 201. */
export async function createPerson(user: User, request: Request) {
  const name = validate(await jsonBody<unknown>(request), false).name ?? "";
  const personId = await write.createPerson(user.id, name);
  const person = await dbq.ownedPersonAnyKind(user.id, personId);
  if (!person) throw ApiError.notFound();
  return json(personOut(person), 201);
}

/** DELETE /api/persons/{id}/ (S3: its faces become unlabelled). */
export async function destroyPerson(user: User, id: string, q: QueryMap) {
  const person = await load(user.id, id, q);
  await write.deletePerson(person.id);
  return new Response(null, { status: 204 });
}
