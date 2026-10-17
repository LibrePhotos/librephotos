/**
 * A video's square thumbnail is an mp4 clip, which an <img> shows broken: the selection's share dialog
 * and date preview showed every selected video as a broken image (#2707).
 */
import React, { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { MediaThumbnail } from "./MediaThumbnail";

vi.mock("../../api_client/urls", () => ({ serverAddress: "", shareAddress: "" }));

beforeAll(setUpMantineDom);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("MediaThumbnail", () => {
  it("draws a photo as an image of its small square thumbnail", async () => {
    const { container } = await renderInMantine(<MediaThumbnail imageHash="abc" size={28} />);
    expect(container.querySelector("video")).toBeNull();
    expect(defined(container.querySelector("img")).getAttribute("src")).toBe("/media/square_thumbnails_small/abc");
  });

  it("draws a known video as a paused <video> of its first frame", async () => {
    const { container } = await renderInMantine(
      <MediaThumbnail imageHash="abc" size={40} kind="square_thumbnails" video />
    );
    expect(container.querySelector("img")).toBeNull();
    const video = defined(container.querySelector("video"));
    expect(video.getAttribute("src")).toBe("/media/square_thumbnails/abc#t=0.001");
    expect(video.muted).toBe(true);
    expect(video.autoplay).toBe(false);
    expect(video.getAttribute("aria-hidden")).toBe("true");
  });

  it("shows a video whose type the caller did not know once its image fails to load", async () => {
    const { container } = await renderInMantine(<MediaThumbnail imageHash="abc" size={40} alt="Beach" />);
    const image = defined(container.querySelector("img"));
    await act(async () => {
      image.dispatchEvent(new Event("error"));
    });
    expect(container.querySelector("img")).toBeNull();
    expect(defined(container.querySelector("video")).getAttribute("aria-label")).toBe("Beach");
  });
});
