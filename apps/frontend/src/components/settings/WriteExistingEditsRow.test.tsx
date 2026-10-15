/**
 * "Write existing edits to files" in Metadata Options (#2287): disabled while writing is Off or the
 * choice has an unsaved change, and after a confirm that names the target it starts the job. Into
 * sidecars the confirm is plain; into the media files its button is red.
 */
import { User, type WriteMetadataPreview } from "@librephotos/api-client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { click, dialogButton, openDialog, renderInMantine, setUpMantineDom } from "../modals/confirmModal.test-utils";
import { WriteExistingEditsRow } from "./WriteExistingEditsRow";

const stubs = vi.hoisted(() => ({
  preview: { data: undefined as WriteMetadataPreview | undefined, isLoading: false },
  previewKey: [] as [string, boolean][],
  start: vi.fn<() => void>(),
}));

vi.mock("../../api_client/settings", () => ({
  useWriteMetadataPreviewQuery: (mode: string, faceTags: boolean) => {
    stubs.previewKey.push([mode, faceTags]);
    return stubs.preview;
  },
}));
vi.mock("../../api_client/jobs/hooks", () => ({
  useWriteMetadataToFiles: () => ({ start: stubs.start, running: false, job: undefined }),
}));

function userWith(save_metadata_to_disk: string, save_face_tags_to_disk = false): User {
  return User.parse({
    id: 1,
    username: "admin",
    email: "",
    confidence: 0.1,
    transcode_videos: false,
    semantic_search_topk: 0,
    first_name: "",
    last_name: "",
    public_photo_samples: [],
    public_photo_count: 0,
    date_joined: "2026-01-01T00:00:00Z",
    photo_count: 0,
    favorite_min_rating: 4,
    image_scale: 2,
    save_metadata_to_disk,
    save_face_tags_to_disk,
    datetime_rules: "[]",
    default_timezone: "UTC",
    public_sharing: false,
    min_cluster_size: 0,
    min_samples: 1,
    cluster_selection_epsilon: 0.05,
    llm_settings: null,
  });
}

const PREVIEW: WriteMetadataPreview = {
  target: "sidecar",
  counts: [
    { type: "ratings", photos: 1284 },
    { type: "dates", photos: 0 },
    { type: "keywords", photos: 40 },
    { type: "titles", photos: 3 },
  ],
  total: 1300,
};

async function render(saved: User, edited: User = saved) {
  const { container } = await renderInMantine(<WriteExistingEditsRow saved={saved} edited={edited} />);
  const button = [...container.querySelectorAll("button")].find(b => b.textContent === "Write now");
  if (!button) throw new Error("no Write now button");
  return { container, button };
}

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

afterEach(() => {
  stubs.preview = { data: undefined, isLoading: false };
  stubs.previewKey = [];
  stubs.start.mockReset();
  document.body.innerHTML = "";
});

describe("WriteExistingEditsRow", () => {
  it("is disabled while writing is Off, and says why", async () => {
    stubs.preview.data = { target: null, counts: [], total: 0 };
    const { container, button } = await render(userWith("OFF"));

    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(container.textContent).toContain("Turn on Save to sidecar or Save to media file above first.");
    await click(button);
    expect(openDialog()).toBeNull();
  });

  it("waits for an unsaved change of the write choice", async () => {
    stubs.preview.data = PREVIEW;
    const { container, button } = await render(userWith("SIDECAR_FILE"), userWith("MEDIA_FILE"));

    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(container.textContent).toContain("Save your changes first");
    // The counts follow the saved settings.
    expect(stubs.previewKey.at(-1)).toEqual(["SIDECAR_FILE", false]);
  });

  it("asks to save first when writing was just turned on", async () => {
    stubs.preview.data = { target: null, counts: [], total: 0 };
    const { container, button } = await render(userWith("OFF"), userWith("SIDECAR_FILE"));

    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(container.textContent).toContain("Save your changes first");
  });

  it("says when there is nothing to write", async () => {
    stubs.preview.data = { target: "sidecar", counts: [{ type: "ratings", photos: 0 }], total: 0 };
    const { container, button } = await render(userWith("SIDECAR_FILE"));

    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(container.textContent).toContain("Your photos have no edits to write");
  });

  it("names what it writes and starts the job after a plain confirm in sidecar mode", async () => {
    stubs.preview.data = PREVIEW;
    const { container, button } = await render(userWith("SIDECAR_FILE", true));

    expect(container.textContent).toContain("This writes the ratings and tags of 1300 photos to their .xmp files.");
    expect(stubs.previewKey.at(-1)).toEqual(["SIDECAR_FILE", true]);
    await click(button);

    const dialog = openDialog()?.textContent ?? "";
    expect(dialog).toContain("Write to 1300 sidecar files?");
    expect(dialog).toContain("Ratings1284 photos");
    expect(dialog).toContain("Tags, as keywords40 photos");
    expect(dialog).not.toContain("Dates");
    const confirm = dialogButton("Write to files");
    expect(confirm.style.getPropertyValue("--button-bg")).not.toContain("red");
    expect(stubs.start).not.toHaveBeenCalled();

    await click(confirm);
    expect(stubs.start).toHaveBeenCalledOnce();
    expect(openDialog()).toBeNull();
  });

  it("asks in red before changing originals, and Cancel starts nothing", async () => {
    stubs.preview.data = { ...PREVIEW, target: "media_file" };
    const { container, button } = await render(userWith("MEDIA_FILE"));

    expect(container.textContent).toContain("into the photo files themselves");
    await click(button);

    expect(openDialog()?.textContent).toContain("Change 1300 original files?");
    expect(openDialog()?.textContent).toContain("Keep a backup of your originals.");
    expect(dialogButton("Write into originals").style.getPropertyValue("--button-bg")).toContain("red");
    await click(dialogButton("Cancel"));

    expect(stubs.start).not.toHaveBeenCalled();
  });
});
