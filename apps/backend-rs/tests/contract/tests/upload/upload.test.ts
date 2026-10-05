// Upload area (03 §5): GET /exists/{md5+uid}, POST /upload/ (1 MB chunks,
// Content-Range total = chunk size), POST /upload/complete/.
//
// The flow cases write into the servers' media trees (staged chunks, the
// imported file under <scan_directory>/uploads/web). Run them only against
// clones with their own media copy: LP_MUTATION=1.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { authzMatrix, authzProblems, type AuthzCase } from "../../src/authz";
import { call, type Response } from "../../src/client";
import { BASE_URL, hasBase, hasRef, REF_URL } from "../../src/env";
import { manifest, photo, user } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { UploadError, UploadExistResponse, UploadResponse } from "../../src/schemas/upload";
import { expectTwin } from "../../src/twin";

const mutation = process.env.LP_MUTATION === "1";
const fixtureRoot = () => (manifest() as unknown as { photos_root: string }).photos_root;

function form(fields: Record<string, string>, chunk?: Uint8Array): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  if (chunk) f.append("file", new Blob([chunk]));
  return f;
}

function md5(data: Uint8Array): string {
  return createHash("md5").update(data).digest("hex");
}

async function sendChunk(
  baseUrl: string,
  data: Uint8Array,
  offset: number,
  uploadId: string,
  role: "alice" | "anonymous" = "alice",
): Promise<Response> {
  const fields: Record<string, string> = { md5: "", offset: String(offset) };
  if (uploadId) fields.upload_id = uploadId;
  return call(
    role,
    {
      method: "POST",
      path: "/api/upload/",
      rawBody: form(fields, data),
      headers: { "Content-Range": `bytes ${offset}-${offset + data.length - 1}/${data.length}` },
    },
    baseUrl,
  );
}

/** The frontend's upload: 1 MB chunks, then complete with md5 + filename. */
async function uploadFile(baseUrl: string, data: Uint8Array, filename: string, md5sum = md5(data)) {
  const size = 1024 * 1024;
  let offset = 0;
  let uploadId = "";
  for (let start = 0; start < data.length; start += size) {
    const res = await sendChunk(baseUrl, data.subarray(start, start + size), offset, uploadId);
    expect(res.status).toBe(200);
    const body = expectSchema(UploadResponse, res.body);
    offset = body.offset;
    uploadId = body.upload_id;
  }
  const done = await call(
    "alice",
    { method: "POST", path: "/api/upload/complete/", rawBody: form({ upload_id: uploadId, md5: md5sum, filename }) },
    baseUrl,
  );
  return { uploadId, done };
}

describe.skipIf(!hasBase)("GET /api/exists/{hash}", () => {
  it("contract: the requester's own photo exists", async () => {
    const res = await call("alice", { path: `/api/exists/${photo("alice/e2e_01").image_hash}` });
    expect(res.status).toBe(200);
    expect(expectSchema(UploadExistResponse, res.body).exists).toBe(true);
  });

  it.each([
    ["own photo", "alice", "alice/e2e_01"],
    ["another user's photo", "bob", "alice/e2e_01"],
    ["a photo shared to the requester", "bob", "alice/e2e_06"],
    ["bob's own copy of the same bytes", "bob", "bob/e2e_01"],
  ] as const)("twin: %s", async (_name, role, key) => {
    await expectTwin(role, { path: `/api/exists/${photo(key).image_hash}` }, { project: ["exists"] });
  });

  it("twin: an unknown hash", async () => {
    await expectTwin("alice", { path: "/api/exists/00000000000000000000000000000000" }, { project: ["exists"] });
  });

  const cases: AuthzCase[] = [
    {
      name: "exists (alice's hash)",
      req: { path: `/api/exists/${photo("alice/e2e_01").image_hash}/` },
      expect: { anonymous: 401, alice: 200, bob: 200, dave: 200 },
    },
  ];
  it.each(cases)("authz: $name", async c => {
    const matrix = await authzMatrix([c]);
    expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });
});

describe.skipIf(!hasBase)("POST /api/upload/", () => {
  const cases: AuthzCase[] = [
    {
      name: "chunk without a file",
      req: { method: "POST", path: "/api/upload/", rawBody: form({ md5: "" }) },
      // Plain Django views: anonymous is a 403, not DRF's 401.
      expect: { anonymous: 403, alice: 400, bob: 400 },
    },
  ];
  it.each(cases)("authz: $name", async c => {
    const matrix = await authzMatrix([c]);
    expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
  });

  it.each([
    ["no credentials", "anonymous", {}],
    ["an invalid token", "anonymous", { Authorization: "Bearer not-a-token" }],
  ] as const)("twin: %s is a 403 with the chunked-upload detail", async (_name, role, headers) => {
    await expectTwin(
      role,
      { method: "POST", path: "/api/upload/", rawBody: form({ md5: "" }, new Uint8Array([1, 2, 3])), headers },
      { project: ["detail"], refStable: false },
    );
  });

  it("twin: a request without a chunk", async () => {
    await expectTwin("alice", { method: "POST", path: "/api/upload/", rawBody: form({ md5: "" }) }, {
      project: ["detail"],
      refStable: false,
    });
  });

  it("twin: an unknown upload id is a 404", async () => {
    await expectTwin(
      "alice",
      {
        method: "POST",
        path: "/api/upload/",
        rawBody: form({ upload_id: "0123456789abcdef0123456789abcdef" }, new Uint8Array([1])),
      },
      { project: ["no_such_field"], refStable: false },
    );
  });
});

describe.skipIf(!hasBase || !hasRef || !mutation)("upload flow (mutating, LP_MUTATION=1)", () => {
  const servers = () => [REF_URL, BASE_URL];

  it("contract: a first chunk answers upload_id, offset and expires", async () => {
    for (const base of servers()) {
      const data = new Uint8Array(1000).fill(7);
      const res = await sendChunk(base, data, 0, "");
      expect(res.status).toBe(200);
      const body = expectSchema(UploadResponse, res.body) as { upload_id: string; offset: number; expires?: string };
      expect(body.offset).toBe(1000);
      expect((res.body as { expires: string }).expires).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{3})?Z$/);
    }
  });

  it("twin: offsets that do not match report the current offset", async () => {
    const answers = [];
    for (const base of servers()) {
      const first = await sendChunk(base, new Uint8Array(10).fill(1), 0, "");
      const id = (first.body as { upload_id: string }).upload_id;
      const res = await sendChunk(base, new Uint8Array(5).fill(2), 3, id);
      answers.push([res.status, res.body]);
    }
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[0]).toEqual([400, { detail: "Offsets do not match", offset: 10 }]);
  });

  it("twin: completion errors (missing params, md5 mismatch, not an image)", async () => {
    const results: unknown[][] = [];
    for (const base of servers()) {
      const row: unknown[] = [];
      const missing = await call("alice", { method: "POST", path: "/api/upload/complete/", rawBody: form({ md5: "x" }) }, base);
      row.push(missing.status, missing.body);
      const text = new TextEncoder().encode("this is not a picture");
      const bad = await uploadFile(base, text, "x.jpg", "0".repeat(32));
      row.push(bad.done.status, bad.done.body);
      const junk = await uploadFile(base, text, "notes.txt");
      row.push(junk.done.status, expectSchema(UploadError, junk.done.body).detail);
      results.push(row);
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[0]).toEqual([
      400,
      { detail: "Both 'upload_id' and 'md5' are required" },
      400,
      { detail: "md5 checksum does not match" },
      400,
      "File type not allowed",
    ]);
  });

  it("twin: a known picture is a duplicate, a new one is imported", async () => {
    const own = readFileSync(`${fixtureRoot()}/alice/e2e/e2e_01.jpg`);
    const foreign = new Uint8Array(readFileSync(`${fixtureRoot()}/carol/carol_own_01.jpg`));
    const hash = `${md5(foreign)}${user("alice").id}`;
    const results: unknown[][] = [];
    for (const base of servers()) {
      const dup = await uploadFile(base, new Uint8Array(own), "e2e_01.jpg");
      const before = await call("alice", { path: `/api/exists/${hash}` }, base);
      const imported = await uploadFile(base, foreign, "from carol.jpg");
      const after = await call("alice", { path: `/api/exists/${hash}` }, base);
      results.push([dup.done.status, dup.done.body, before.body, imported.done.status, imported.done.body, after.body]);
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[0]).toEqual([200, {}, { exists: false }, 200, {}, { exists: true }]);
  });
});
