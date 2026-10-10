import { describe, expect, it } from "vitest";
import { autoTagsOf, generatedCaptionOf, userCaptionOf } from "./captions";

describe("caption readers", () => {
  const captions = {
    user_caption: "Beach day",
    im2txt: "a beach with people",
    openclip_vitb32: { tags: ["beach", "sea"] },
    places365: { attributes: ["sunny"] },
  };

  it("read the owner's caption and the model's suggestion", () => {
    expect(userCaptionOf(captions)).toBe("Beach day");
    expect(generatedCaptionOf(captions)).toBe("a beach with people");
  });

  it("read the tags of the active tagging model, as stored", () => {
    expect(autoTagsOf(captions, "openclip_vitb32")).toBe(captions.openclip_vitb32.tags);
    expect(autoTagsOf(captions, "places365")).toBeUndefined();
    expect(autoTagsOf(captions, "an_earlier_tagger")).toBeUndefined();
  });

  it("treat missing captions and values of another type as none", () => {
    for (const empty of [null, undefined, {}]) {
      expect(userCaptionOf(empty)).toBe("");
      expect(generatedCaptionOf(empty)).toBeUndefined();
      expect(autoTagsOf(empty, "openclip_vitb32")).toBeUndefined();
    }
    const odd = { user_caption: 3, im2txt: null, openclip_vitb32: { tags: [1, 2] } };
    expect(userCaptionOf(odd)).toBe("");
    expect(generatedCaptionOf(odd)).toBeUndefined();
    expect(autoTagsOf(odd, "openclip_vitb32")).toBeUndefined();
  });
});
