// Upload area authorization (03 §5): an upload_id is bound to its uploader,
// the chunked views authenticate the header or the `jwt` cookie themselves
// and report every unusable credential as a 403.
//
// Every case writes staged chunks: LP_MUTATION=1 against clones with their
// own media copy.
import { describe, expect, it } from "vitest";

import { call, login, type Response } from "../../src/client";
import { BASE_URL, hasBase, hasRef, REF_URL } from "../../src/env";
import type { Role } from "../../src/manifest";

const mutation = process.env.LP_MUTATION === "1";

function form(fields: Record<string, string>, chunk?: Uint8Array): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  if (chunk) f.append("file", new Blob([chunk]));
  return f;
}

async function chunk(
  base: string,
  role: Role,
  data: Uint8Array,
  opts: { uploadId?: string; offset?: number; headers?: Record<string, string> } = {},
): Promise<Response> {
  const offset = opts.offset ?? 0;
  const fields: Record<string, string> = { md5: "" };
  if (opts.uploadId) fields.upload_id = opts.uploadId;
  return call(
    role,
    {
      method: "POST",
      path: "/api/upload/",
      rawBody: form(fields, data),
      headers: { "Content-Range": `bytes ${offset}-${offset + data.length - 1}/${data.length}`, ...opts.headers },
    },
    base,
  );
}

const servers = () => [REF_URL, BASE_URL];

describe.skipIf(!hasBase || !hasRef || !mutation)("upload authorization (mutating, LP_MUTATION=1)", () => {
  it("twin: another user cannot append to, or complete, someone else's upload", async () => {
    const results: unknown[][] = [];
    for (const base of servers()) {
      const first = await chunk(base, "alice", new Uint8Array(8).fill(3));
      expect(first.status).toBe(200);
      const id = (first.body as { upload_id: string }).upload_id;
      const append = await chunk(base, "bob", new Uint8Array(4).fill(4), { uploadId: id, offset: 8 });
      const complete = await call(
        "bob",
        { method: "POST", path: "/api/upload/complete/", rawBody: form({ upload_id: id, md5: "0".repeat(32) }) },
        base,
      );
      // Alice's upload is untouched: her next chunk still starts at 8.
      const own = await chunk(base, "alice", new Uint8Array(4).fill(5), { uploadId: id, offset: 8 });
      results.push([append.status, complete.status, own.status, (own.body as { offset: number }).offset]);
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[0]).toEqual([404, 404, 200, 12]);
  });

  it("twin: the jwt cookie authenticates an upload without a header", async () => {
    const statuses: number[] = [];
    for (const base of servers()) {
      const { access } = await login("alice", base);
      const res = await chunk(base, "anonymous", new Uint8Array(3).fill(1), { headers: { Cookie: `jwt=${access}` } });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200]);
  });

  const refused: [string, (base: string) => Promise<Record<string, string>>][] = [
    ["a refresh token as the bearer", async base => ({ Authorization: `Bearer ${(await login("alice", base)).refresh}` })],
    ["a tampered cookie", async () => ({ Cookie: "jwt=not-a-token" })],
    ["a bearer header without a token", async () => ({ Authorization: "Bearer" })],
    [
      "a bad bearer header even with a good cookie",
      async base => ({ Authorization: "Bearer nope", Cookie: `jwt=${(await login("alice", base)).access}` }),
    ],
  ];
  it.each(refused)("twin: %s is a 403", async (_name, headersFor) => {
    const answers: unknown[] = [];
    for (const base of servers()) {
      const res = await chunk(base, "anonymous", new Uint8Array(3).fill(1), { headers: await headersFor(base) });
      answers.push([res.status, res.body]);
    }
    expect(answers[1]).toEqual(answers[0]);
    expect((answers[0] as [number])[0]).toBe(403);
  });
});
