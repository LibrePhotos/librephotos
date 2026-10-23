/**
 * @jest-environment node
 */
import { parseCompleteResponse } from "../transport";

describe("parseCompleteResponse", () => {
  it("reads the photo the upload made", () => {
    expect(parseCompleteResponse('{"job_id": "j1", "photo_id": "p1"}')).toEqual({ photoId: "p1" });
  });

  it("reads the photo a duplicate upload matched", () => {
    const body = '{"detail": "Photo duplicated. No new import performed.", "photo_id": "p2"}';
    expect(parseCompleteResponse(body)).toEqual({ photoId: "p2" });
  });

  it.each([
    ["no photo (a sidecar)", '{"job_id": null, "photo_id": null}'],
    ["an older server's empty object", "{}"],
    ["an empty body", ""],
    ["a body that is not JSON", "<html>ok</html>"],
    ["a JSON array", '["p1"]'],
    ["an empty id", '{"photo_id": ""}'],
  ])("is null for %s", (_label, body) => {
    expect(parseCompleteResponse(body)).toEqual({ photoId: null });
  });
});
