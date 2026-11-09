/**
 * The profile picture: picked, moved into place, then uploaded. "Unsaved" and the picked picture
 * were two flags, Upload could start twice while the picture was converted, and an uploaded
 * picture stayed in the movable editor as if it still waited for Upload.
 */
import { MantineProvider } from "@mantine/core";
import React, { act, useImperativeHandle } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { ProfileAvatar } from "./ProfileAvatar";

const mocks = vi.hoisted(() => ({
  upload: vi.fn<(variables: { id: string; data: FormData }) => Promise<unknown>>(),
}));

vi.mock("../../api_client/user/hooks", () => ({
  useUpdateAvatarMutation: () => ({ mutate: mocks.upload, mutateAsync: mocks.upload, isPending: false }),
}));
vi.mock("../../util/dataUrl", () => ({
  dataUrlToFile: async (_url: string, name: string) => new File(["png"], name, { type: "image/png" }),
}));
vi.mock("../common/UserAvatar", () => ({ UserAvatar: () => <span data-stored-avatar /> }));
type EditorRef = React.Ref<{ getImageScaledToCanvas: () => { toDataURL: () => string } }>;

function AvatarEditorStub({ ref }: { ref?: EditorRef }) {
  useImperativeHandle(ref, () => ({
    getImageScaledToCanvas: () => ({ toDataURL: () => "data:image/png;base64,cG5n" }),
  }));
  return <span data-avatar-editor />;
}

vi.mock("react-avatar-editor", () => ({ default: AvatarEditorStub }));
vi.mock("./AvatarFacePickerModal", () => ({
  AvatarFacePickerModal: ({ onPick }: { onPick: (image: string) => void }) => (
    <button type="button" onClick={() => onPick("/media/faces/1.jpg")}>
      pick-face
    </button>
  ),
}));

let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
});

beforeEach(async () => {
  mocks.upload.mockReset().mockResolvedValue({});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <ProfileAvatar userId={1} user={{ username: "ada", first_name: "Ada", last_name: "", avatar_url: null }} />
      </MantineProvider>
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const button = (label: string) => [...container.querySelectorAll("button")].find(b => b.textContent === label);
const click = async (label: string) => act(async () => defined(button(label), label).click());

describe("ProfileAvatar", () => {
  it("uploads a picked picture once, however often Upload is clicked", async () => {
    mocks.upload.mockReturnValue(new Promise(() => {}));
    await click("pick-face");
    const upload = defined(button(i18n.t("settings.upload")), "Upload");
    await act(async () => upload.click());
    await act(async () => upload.click());
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });

  it("shows the stored picture again once the upload went through", async () => {
    await click("pick-face");
    await click(i18n.t("settings.upload"));

    expect(button(i18n.t("settings.upload"))).toBeUndefined();
    expect(container.querySelector("[data-avatar-editor]")).toBeNull();
    expect(container.querySelector("[data-stored-avatar]")).not.toBeNull();
  });

  it("keeps the picture to upload again when the upload is refused", async () => {
    mocks.upload.mockRejectedValue(new Error("too large"));
    await click("pick-face");
    await click(i18n.t("settings.upload"));

    expect(button(i18n.t("settings.upload"))).toBeDefined();
    expect(container.querySelector("[data-avatar-editor]")).not.toBeNull();
  });
});
