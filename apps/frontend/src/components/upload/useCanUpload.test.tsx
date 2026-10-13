import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { useCanUpload, type UploadAvailability } from "./useCanUpload";

type Settings = { allow_upload: boolean } | undefined;
type User = { scan_directory: string | null } | undefined;

const stubs = vi.hoisted(() => ({ settings: undefined as Settings, user: undefined as User }));

vi.mock("../../api_client/settings", () => ({ useGetSettingsQuery: () => ({ data: stubs.settings }) }));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: stubs.user }),
}));

let result: UploadAvailability | undefined;
function Harness() {
  result = useCanUpload();
  return null;
}

const availability = async (settings: Settings, user: User) => {
  stubs.settings = settings;
  stubs.user = user;
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(<Harness />);
  });
  await act(async () => {
    root.unmount();
  });
  return result;
};

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

describe("useCanUpload", () => {
  it("is off while the settings load and when uploads are turned off", async () => {
    expect(await availability(undefined, { scan_directory: "/data" })).toBe("off");
    expect(await availability({ allow_upload: false }, { scan_directory: "/data" })).toBe("off");
  });

  it("needs a scan directory that is not blank", async () => {
    expect(await availability({ allow_upload: true }, undefined)).toBe("no_scan_directory");
    expect(await availability({ allow_upload: true }, { scan_directory: null })).toBe("no_scan_directory");
    expect(await availability({ allow_upload: true }, { scan_directory: "  " })).toBe("no_scan_directory");
  });

  it("is ready with uploads on and a scan directory", async () => {
    expect(await availability({ allow_upload: true }, { scan_directory: "/data" })).toBe("ready");
  });
});
