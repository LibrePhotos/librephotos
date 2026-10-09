/**
 * Drawing a face box by hand closes the name dialog straight away, so a box the
 * server refuses (409 overlap, 404 not the owner's photo, 400 bad box) must say so,
 * or it looks as if the face was saved. 401/500 and parse errors toast elsewhere.
 */
import { ResponseParseError } from "@librephotos/api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import i18n from "../../../i18n";
import { notification } from "../../../service/notifications";
import { ApiError } from "../../api";
import { reportAddFaceError } from "./useAddFaceMutation";

describe("reportAddFaceError", () => {
  const requestFailed = vi.spyOn(notification, "requestFailed").mockImplementation(() => {});

  beforeEach(() => {
    requestFailed.mockClear();
  });

  it.each<[number, string]>([
    [409, "toasts.addfaceoverlap"],
    [404, "toasts.addfacenotowner"],
    [400, "toasts.addfacefailed"],
  ])("explains a %i", (status, key) => {
    reportAddFaceError(new ApiError("x", status));
    expect(requestFailed).toHaveBeenCalledWith(i18n.t("toasts.addfacefailedtitle"), i18n.t(key));
  });

  it("explains a request that never reached the server", () => {
    reportAddFaceError(new TypeError("Failed to fetch"));
    expect(requestFailed).toHaveBeenCalledWith(i18n.t("toasts.addfacefailedtitle"), i18n.t("toasts.addfacefailed"));
  });

  it("stays quiet where another toast already fired", () => {
    reportAddFaceError(new ApiError("x", 500));
    reportAddFaceError(new ApiError("x", 401));
    reportAddFaceError(new ZodError([]));
    reportAddFaceError(new ResponseParseError("add face", "bad"));
    expect(requestFailed).not.toHaveBeenCalled();
  });
});
