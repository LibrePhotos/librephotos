/**
 * Saving the timeline's default filter (issue #2130) sends that one field,
 * never the whole user: the whole user carries `avatar` back as a URL, which
 * the server refuses with a 400 for anyone who has an avatar (issue #2153).
 * It updates the cached user; the timeline already sends its filter in full,
 * so its queries are left alone. A failed save says so.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SHOW_EVERYTHING } from "../../../components/photolist/timelineFilter";

const stubs = vi.hoisted(() => ({
  patch: vi.fn(),
  requestFailed: vi.fn(),
  queryClient: undefined as unknown as QueryClient,
}));

vi.mock("../../api", async () => {
  const { QueryClient: Client } = await import("@tanstack/react-query");
  stubs.queryClient = new Client();
  return { fetchClient: { patch: stubs.patch }, queryClient: stubs.queryClient };
});

vi.mock("../../../service/notifications", () => ({
  notification: { requestFailed: stubs.requestFailed },
}));

const { compactTimelineFilter, useSaveDefaultTimelineFilterMutation } =
  await import("./useSaveDefaultTimelineFilterMutation");

const savedUser = {
  id: 7,
  username: "alice",
  email: "",
  confidence: 0.1,
  confidence_person: 0.9,
  transcode_videos: false,
  semantic_search_topk: 0,
  first_name: "",
  public_photo_samples: [],
  last_name: "",
  public_photo_count: 0,
  date_joined: "2026-01-01T00:00:00Z",
  avatar: "/media/avatars/alice.png",
  photo_count: 0,
  nextcloud_server_address: null,
  nextcloud_username: null,
  nextcloud_scan_directory: null,
  avatar_url: "/media/avatars/alice.png",
  favorite_min_rating: 4,
  image_scale: 1,
  save_metadata_to_disk: "OFF",
  datetime_rules: "[]",
  default_timezone: "UTC",
  public_sharing: false,
  confidence_unknown_face: 0.5,
  min_cluster_size: 0,
  min_samples: 1,
  cluster_selection_epsilon: 0.05,
  llm_settings: null,
  default_timeline_filter: { hide_screenshots: true },
};

beforeAll(() => {
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

describe("compactTimelineFilter", () => {
  it("saves only the keys that narrow the timeline", () => {
    expect(compactTimelineFilter(SHOW_EVERYTHING)).toEqual({});
    expect(compactTimelineFilter({ ...SHOW_EVERYTHING, media: "photos", hide_documents: true })).toEqual({
      media: "photos",
      hide_documents: true,
    });
  });
});

describe("useSaveDefaultTimelineFilterMutation", () => {
  async function renderProbe() {
    let mutate: ReturnType<typeof useSaveDefaultTimelineFilterMutation>["mutateAsync"] | undefined;
    function Probe() {
      mutate = useSaveDefaultTimelineFilterMutation().mutateAsync;
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => {
      root.render(
        <QueryClientProvider client={stubs.queryClient}>
          <Probe />
        </QueryClientProvider>
      );
    });
    return mutate!;
  }

  it("says so when the save fails", async () => {
    stubs.patch.mockRejectedValueOnce(new Error("500"));
    const mutate = await renderProbe();
    await act(async () => {
      await mutate({ userId: 7, filter: SHOW_EVERYTHING }).catch(() => {});
    });
    expect(stubs.requestFailed).toHaveBeenCalledTimes(1);
  });

  it("patches only default_timeline_filter and keeps the timeline", async () => {
    stubs.patch.mockReset();
    stubs.patch.mockResolvedValue(savedUser);
    const { queryClient } = stubs;
    queryClient.setQueryData(["userSelfDetails", "7"], { ...savedUser, default_timeline_filter: {} });
    queryClient.setQueryData(["dateAlbums", "none", "key"], []);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    let mutate: ReturnType<typeof useSaveDefaultTimelineFilterMutation>["mutateAsync"] | undefined;
    function Probe() {
      mutate = useSaveDefaultTimelineFilterMutation().mutateAsync;
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>
      );
    });

    await act(async () => {
      await mutate!({ userId: 7, filter: { ...SHOW_EVERYTHING, hide_screenshots: true } });
    });

    expect(stubs.patch).toHaveBeenCalledTimes(1);
    expect(stubs.patch).toHaveBeenCalledWith("/user/7/", { default_timeline_filter: { hide_screenshots: true } });
    expect((queryClient.getQueryData(["userSelfDetails", "7"]) as typeof savedUser).default_timeline_filter).toEqual({
      hide_screenshots: true,
    });
    const invalidated = invalidate.mock.calls.map(([filters]) => filters?.queryKey?.[0]);
    expect(invalidated).toEqual(["userSelfDetails"]);
  });
});
