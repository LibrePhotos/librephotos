/**
 * The stack and duplicate endpoints (issue #2347): the request each one sends and the parsed
 * answer. The fixtures are what api/views/stacks.py and api/views/duplicates.py answered in a test
 * run: a burst stack without a primary photo and a pending duplicate group, whose
 * `is_primary` / `is_kept` the views send as null.
 */
import { describe, expect, it } from "vitest";
import * as endpoints from "../endpoints";
import { countListedStacks, Photo, PhotoStack, PigPhoto } from "../schemas";
import { defined } from "./defined";
import duplicateDetail from "./fixtures/duplicateDetail.json";
import duplicateList from "./fixtures/duplicateList.json";
import stackDetail from "./fixtures/stackDetail.json";
import stackList from "./fixtures/stackList.json";
import { fakeServer } from "./harness";

const API = "https://demo.example.com/api";

describe("stack reads", () => {
  it("reads a page of stacks, legacy has_next/has_previous included", async () => {
    const { client, requests } = fakeServer({ ...stackList, has_next: false, has_previous: false });
    const page = await endpoints.fetchStacks(client, { page: 1, pageSize: 20, stackType: "burst" });
    expect(defined(requests[0]).url).toBe(`${API}/stacks?page=1&page_size=20&stack_type=burst`);
    expect(page.results.map(stack => stack.stack_type)).toEqual(["burst", "manual"]);
    expect(defined(page.results[0]).primary_photo).toBeNull();
  });

  it("leaves out the parameters that are not set", async () => {
    const { client, requests } = fakeServer(stackList);
    await endpoints.fetchStacks(client);
    await endpoints.fetchStacks(client, { page: 0, stackType: "" });
    expect(requests.map(request => request.url)).toEqual([`${API}/stacks`, `${API}/stacks`]);
  });

  it("reads a stack without a primary photo, whose is_primary the view sends as null", async () => {
    const { client, requests } = fakeServer(stackDetail);
    const stack = await endpoints.fetchStack(client, stackDetail.id);
    expect(defined(requests[0]).url).toBe(`${API}/stacks/${stackDetail.id}/`);
    expect(stack.photos.map(photo => photo.is_primary)).toEqual([false, false, false]);
  });

  it("reads a photo's file variants, a missing main file's is_main as false", () => {
    const photo = { ...defined(stackDetail.photos[0]), is_primary: true };
    const variant = { hash: "h", path: "/photos/a.CR2", type: "raw", filename: "a.CR2" };
    const stack = PhotoStack.parse({
      ...stackDetail,
      photos: [
        {
          ...photo,
          file_variants: [
            { ...variant, is_main: null },
            { ...variant, is_main: true },
          ],
        },
      ],
    });
    const parsed = defined(stack.photos[0]);
    expect(parsed.is_primary).toBe(true);
    expect(parsed.file_variants?.map(v => v.is_main)).toEqual([false, true]);
  });

  it("reads the stack stats", async () => {
    const stats = {
      total_stacks: 2,
      by_type: { burst: 1, bracket: 0, manual: 1 },
      photos_in_stacks: 5,
      total_photos: 6,
    };
    const { client, requests } = fakeServer(stats);
    expect(await endpoints.fetchStackStats(client)).toEqual(stats);
    expect(defined(requests[0]).url).toBe(`${API}/stacks/stats/`);
  });
});

describe("countListedStacks", () => {
  it("leaves out legacy stack types", () => {
    const stats = {
      total_stacks: 10,
      by_type: { burst: 3, bracket: 2, manual: 1, raw_jpeg: 3, live_photo: 1 },
      photos_in_stacks: 30,
      total_photos: 100,
    };
    expect(countListedStacks(stats)).toBe(6);
  });

  it("treats a missing type as none", () => {
    expect(countListedStacks({ total_stacks: 0, by_type: {}, photos_in_stacks: 0, total_photos: 0 })).toBe(0);
  });
});

/*
 * Migration 0112 left the legacy RAW + JPEG and Live Photo stacks it could not convert, and photo
 * lists, photo details and the stack detail still return them: one such photo must not fail the
 * parse of a whole timeline page or of the lightbox.
 */
describe("legacy RAW + JPEG and Live Photo stacks", () => {
  const stackId = "6f1c1d4e-2b1a-4c3d-9e8f-0a1b2c3d4e5f";

  it.each(["raw_jpeg", "live_photo"])("parse in a photo list item (%s)", type => {
    const item = PigPhoto.parse({
      id: "0d8e8f1a-1b2c-4d3e-8f9a-0b1c2d3e4f5a",
      image_hash: "abc",
      aspectRatio: 1.5,
      stacks: [{ id: stackId, type, photo_count: 2, is_primary: true }],
    });
    expect(item.stacks?.[0]?.type).toBe(type);
  });

  it("parse in a photo's stack details", () => {
    const stacks = Photo.shape.stacks.parse([
      { id: stackId, type: "live_photo", type_display: "Live Photo", photo_count: 2, is_primary: true, photos: [] },
    ]);
    expect(stacks?.[0]?.type).toBe("live_photo");
  });

  it("parse as a stack detail", () => {
    const stack = PhotoStack.parse({ ...stackDetail, stack_type: "raw_jpeg", photos: [] });
    expect(stack.stack_type).toBe("raw_jpeg");
  });
});

describe("stack changes", () => {
  it("creates a manual stack, merges and removes photos by hash", async () => {
    const { client, requests } = fakeServer({ status: "created", stack_id: "s1", photo_count: 2 });
    expect((await endpoints.createManualStack(client, ["a", "b"])).stack_id).toBe("s1");
    const merge = fakeServer({ status: "merged", stack_id: "s1", photo_count: 4, merged_count: 1 });
    expect((await endpoints.mergeStacks(merge.client, ["a", "c"])).merged_count).toBe(1);
    const remove = fakeServer({ status: "updated", removed_count: 1, total_count: 2 });
    expect((await endpoints.removePhotosFromStack(remove.client, "s1", ["c"])).total_count).toBe(2);
    expect([...requests, ...merge.requests, ...remove.requests].map(({ url, body }) => ({ url, body }))).toEqual([
      { url: `${API}/stacks/manual/`, body: { photo_hashes: ["a", "b"] } },
      { url: `${API}/stacks/merge/`, body: { photo_hashes: ["a", "c"] } },
      { url: `${API}/stacks/s1/remove/`, body: { photo_hashes: ["c"] } },
    ]);
  });

  it("reads a removal that deleted the stack (fewer than two photos left)", async () => {
    const answer = { status: "deleted", removed_count: 1, message: "Stack deleted because fewer than 2 photos remain" };
    const { client } = fakeServer(answer);
    expect(await endpoints.removePhotosFromStack(client, "s1", ["b"])).toEqual(answer);
  });

  it("sets the cover photo and deletes a stack", async () => {
    const { client, requests } = fakeServer({ status: "updated", primary_photo_hash: "b" });
    expect((await endpoints.setStackPrimary(client, "s1", "b")).primary_photo_hash).toBe("b");
    const deleted = fakeServer({ status: "deleted", unlinked_count: 2 });
    expect((await endpoints.deleteStack(deleted.client, "s1")).unlinked_count).toBe(2);
    expect(defined(requests[0])).toMatchObject({ url: `${API}/stacks/s1/primary/`, body: { photo_hash: "b" } });
    expect(defined(deleted.requests[0])).toMatchObject({ url: `${API}/stacks/s1/`, method: "DELETE" });
  });
});

describe("duplicate reads", () => {
  it("reads a page of duplicate groups with its filters, in the order the web sent them", async () => {
    const { client, requests } = fakeServer(duplicateList);
    const page = await endpoints.fetchDuplicates(client, { duplicateType: "visual_duplicate", status: "pending" });
    expect(defined(requests[0]).url).toBe(
      `${API}/duplicates?duplicate_type=visual_duplicate&status=pending&page=1&page_size=20`
    );
    expect(defined(page.results[0]).kept_photo).toBeNull();
    expect(page.count).toBe(1);
  });

  it("reads a pending group, whose is_kept the view sends as null", async () => {
    const { client, requests } = fakeServer(duplicateDetail);
    const group = await endpoints.fetchDuplicate(client, duplicateDetail.id);
    expect(defined(requests[0]).url).toBe(`${API}/duplicates/${duplicateDetail.id}`);
    expect(group.photos.map(photo => photo.is_kept)).toEqual([false, false]);
    expect(group.suggested_photo_hash).toBe(duplicateDetail.suggested_photo_hash);
  });

  it("reads the duplicate stats", async () => {
    const stats = {
      total_duplicates: 1,
      pending_duplicates: 1,
      resolved_duplicates: 0,
      dismissed_duplicates: 0,
      by_type: { exact_copy: 0, visual_duplicate: 1 },
      photos_in_duplicates: 2,
      total_photos: 6,
      potential_savings_bytes: 0,
      potential_savings_mb: 0,
    };
    const { client, requests } = fakeServer(stats);
    expect(await endpoints.fetchDuplicateStats(client)).toEqual(stats);
    expect(defined(requests[0]).url).toBe(`${API}/duplicates/stats`);
  });
});

describe("duplicate changes", () => {
  it("resolves, dismisses, reverts and deletes a group", async () => {
    const resolve = fakeServer({ status: "resolved", kept_photo: "a", trashed_count: 1 });
    expect((await endpoints.resolveDuplicate(resolve.client, "d1", "a", true)).trashed_count).toBe(1);
    const dismiss = fakeServer({ status: "dismissed" });
    expect((await endpoints.dismissDuplicate(dismiss.client, "d1")).status).toBe("dismissed");
    const revert = fakeServer({ status: "reverted", restored_count: 1 });
    expect((await endpoints.revertDuplicate(revert.client, "d1")).restored_count).toBe(1);
    const remove = fakeServer({ status: "deleted", unlinked_count: 2 });
    expect((await endpoints.deleteDuplicate(remove.client, "d1")).unlinked_count).toBe(2);
    const sent = [resolve, dismiss, revert, remove].map(({ requests }) => defined(requests[0]));
    expect(sent.map(({ url, method, body }) => ({ url, method, body }))).toEqual([
      { url: `${API}/duplicates/d1/resolve`, method: "POST", body: { keep_photo_hash: "a", trash_others: true } },
      { url: `${API}/duplicates/d1/dismiss`, method: "POST", body: {} },
      { url: `${API}/duplicates/d1/revert`, method: "POST", body: {} },
      { url: `${API}/duplicates/d1/delete`, method: "DELETE", body: undefined },
    ]);
  });
});
