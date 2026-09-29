// Stack and duplicate mutations, in order, on both servers. They change the
// database, so the file only runs with LP_MUTATIONS=1 against two fresh
// clones (each with its own media copy); state parity is then checked with
// fixture/dump_state.py (see tests/README.md §4).
import {
  CreateManualStackResponseSchema,
  DeleteStackResponse,
  MergeStacksResponseSchema,
  RemoveFromStackResponseSchema,
  SetPrimaryResponse,
} from "@fe/stacks/types";
import { ResolveDuplicateResponse } from "@fe/duplicates/types";
import type { ZodTypeAny } from "zod";
import { describe, expect, it } from "vitest";

import { call, type Request } from "../../src/client";
import { BASE_URL, hasBase, REF_URL } from "../../src/env";
import { manifest, photo } from "../../src/manifest";
import { expectSchema } from "../../src/schema";
import { RevertResponse, StatusOnly, UnlinkResponse } from "../../src/schemas/stats_admin_stacks_dupes";

const enabled = hasBase && process.env.LP_MUTATIONS === "1";
const h = (k: string) => photo(k).image_hash;

/** Send to both servers; same status, same body except minted stack ids. */
async function both(req: Request | ((base: string) => Request), schema?: ZodTypeAny) {
  const make = (base: string) => (typeof req === "function" ? req(base) : req);
  const ref = await call("alice", make(REF_URL), REF_URL);
  const actual = await call("alice", make(BASE_URL), BASE_URL);
  expect(actual.status).toBe(ref.status);
  const strip = (b: unknown) => {
    if (b && typeof b === "object" && !Array.isArray(b)) {
      const { stack_id: _id, ...rest } = b as Record<string, unknown>;
      return rest;
    }
    return b;
  };
  if (ref.status < 400) {
    expect(strip(actual.body)).toEqual(strip(ref.body));
    if (schema) expectSchema(schema, actual.body);
  }
  return { ref, actual };
}

describe.skipIf(!enabled)("stack and duplicate mutations", () => {
  const burst = () => manifest().stacks.burst.id;
  const dup = () => manifest().duplicates.visual.id;
  const created = new Map<string, string>();

  it("stacks", async () => {
    await both({ method: "POST", path: `/api/stacks/${burst()}/primary/`, body: { photo_hash: h("alice/burst_1") } }, SetPrimaryResponse);
    await both({ method: "POST", path: `/api/stacks/${burst()}/remove/`, body: { photo_hashes: [h("alice/burst_1")] } }, RemoveFromStackResponseSchema);
    const made = await both(
      { method: "POST", path: "/api/stacks/manual/", body: { photo_hashes: [h("alice/e2e_01"), h("alice/e2e_02")] } },
      CreateManualStackResponseSchema,
    );
    created.set(REF_URL, (made.ref.body as { stack_id: string }).stack_id);
    created.set(BASE_URL, (made.actual.body as { stack_id: string }).stack_id);
    await both({ method: "POST", path: "/api/stacks/merge/", body: { photo_hashes: [h("alice/manual_a"), h("alice/e2e_01")] } }, MergeStacksResponseSchema);
    await both(
      base => ({
        method: "POST",
        path: `/api/stacks/${created.get(base)}/remove/`,
        body: { photo_hashes: [h("alice/manual_a"), h("alice/manual_b"), h("alice/e2e_01"), h("alice/e2e_02")] },
      }),
      RemoveFromStackResponseSchema,
    );
    await both({ method: "DELETE", path: `/api/stacks/${burst()}/` }, DeleteStackResponse);
  });

  it("duplicates", async () => {
    await both({ method: "POST", path: `/api/duplicates/${dup()}/resolve`, body: { keep_photo_hash: h("alice/dup_original") } }, ResolveDuplicateResponse);
    await both({ method: "POST", path: `/api/duplicates/${dup()}/revert`, body: {} }, RevertResponse);
    await both({ method: "POST", path: `/api/duplicates/${dup()}/revert`, body: {} });
    await both(
      { method: "POST", path: `/api/duplicates/${dup()}/resolve`, body: { keep_photo_hash: h("alice/dup_resized"), trash_others: false } },
      ResolveDuplicateResponse,
    );
    await both({ method: "POST", path: `/api/duplicates/${dup()}/dismiss`, body: {} }, StatusOnly);
    await both({ method: "DELETE", path: `/api/duplicates/${dup()}/delete` }, UnlinkResponse);
  });
});
