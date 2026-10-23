/**
 * A photo's rights (#425): "Set rights…" for a selection, the summary its dialog opens with, and the
 * owner's default rights.
 */
import { describe, expect, it } from "vitest";
import * as endpoints from "../endpoints";
import { PhotoLicenseId, photoLicenseUrl } from "../schemas";
import { defined } from "./defined";
import { fakeServer } from "./harness";

const API = "https://demo.example.com/api";
const DEED = /^https:\/\/creativecommons\.org\/(licenses|publicdomain)\/[a-z-]+\/[0-9.]+\/$/;

describe("photo rights", () => {
  it("sends the hashes, the rights and what to keep", async () => {
    const { client, requests } = fakeServer({ count: 2, kept: 1 });
    const answer = await endpoints.setPhotosRights(client, ["h1"], { license: "cc-by-4.0", creator: null }, "file");
    expect(defined(requests[0])).toEqual({
      url: `${API}/photos/rights/`,
      method: "POST",
      body: { image_hashes: ["h1"], license: "cc-by-4.0", creator: null, keep: "file" },
    });
    expect(answer).toEqual({ count: 2, kept: 1 });
  });

  it("sends a selected-all set as the query and its exclusions", async () => {
    const { client, requests } = fakeServer({ count: 7, kept: 0 });
    await endpoints.setPhotosRights(client, [], { copyright: "(c) {year} Anna" }, "none", {
      query: { favorite: true },
      excludedHashes: ["x"],
    });
    expect(defined(requests[0]).body).toEqual({
      select_all: true,
      query: { favorite: true },
      excluded_hashes: ["x"],
      copyright: "(c) {year} Anna",
      keep: "none",
    });
  });

  it("reads the summary of a selection", async () => {
    const summary = {
      count: 24,
      from_file: 7,
      copyright: { value: null, mixed: true },
      creator: { value: "Anna Berger", mixed: false },
      license: { value: null, mixed: false },
    };
    const { client, requests } = fakeServer(summary);
    expect(await endpoints.fetchRightsSummary(client, ["h1", "h2"])).toEqual(summary);
    expect(defined(requests[0]).url).toBe(`${API}/photos/rights-summary/`);
  });

  it("counts and applies the default rights", async () => {
    const counts = fakeServer({ total: 12408, missing: 318 });
    expect(await endpoints.fetchRightsDefaultCounts(counts.client)).toEqual({ total: 12408, missing: 318 });
    expect(defined(counts.requests[0]).url).toBe(`${API}/photos/rights/apply-default/`);

    const apply = fakeServer({ count: 318, kept: 0 });
    expect(await endpoints.applyRightsDefault(apply.client, "any")).toEqual({ count: 318, kept: 0 });
    expect(defined(apply.requests[0]).body).toEqual({ keep: "any" });
  });

  it("knows the deed of every license but all rights reserved", () => {
    for (const id of PhotoLicenseId.options) {
      if (id === "all-rights-reserved") expect(photoLicenseUrl(id)).toBeNull();
      else expect(photoLicenseUrl(id)).toMatch(DEED);
    }
  });
});
