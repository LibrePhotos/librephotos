/**
 * The Results card of a Check file contents job (#2040): counts in plain words, a table per user
 * when the run covered several, and the changed files with what became of them.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { setUpMantineDom } from "../modals/confirmModal.test-utils";
import { parseCheckFileContentsResult, type CheckFileContentsResult } from "./checkFileContentsResult";
import { CheckFileContentsResults } from "./CheckFileContentsResults";

const counts = {
  checked: 10,
  unchanged: 6,
  missing: 0,
  unreadable: 1,
  new_picture: 1,
  same_picture: 1,
  similar_picture: 0,
  uncomparable: 1,
};

const jobResult = {
  status: "partial_failure",
  ...counts,
  users: [
    { user_id: 1, username: "mina", ...counts, checked: 7 },
    { user_id: 2, username: "jo", ...counts, checked: 3 },
  ],
  changed: [
    { path: "/photos/mina/IMG_1.jpg", verdict: "new_picture", photo_id: "p1", named_faces_removed: 2 },
    { path: "/photos/mina/IMG_2.jpg", verdict: "same_picture", photo_id: "p2", named_faces_removed: 0 },
  ],
  rescans: 2,
  error_count: 1,
  errors: ["/photos/jo/x.jpg: Permission denied"],
};

let root: Root;
let container: HTMLDivElement;

beforeAll(async () => {
  setUpMantineDom();
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderResults(result: CheckFileContentsResult) {
  await act(async () => {
    root.render(
      <MantineProvider env="test">
        <CheckFileContentsResults result={result} />
      </MantineProvider>
    );
  });
}

describe("CheckFileContentsResults", () => {
  it("says what became of the files, per user, and lists the changed ones", async () => {
    await renderResults(defined(parseCheckFileContentsResult(jobResult), "the parsed result"));

    const text = container.textContent ?? "";
    expect(text).toContain("10 files read");
    expect(text).toContain("New picture");
    expect(text).toContain("Same picture, new file");
    expect(text).toContain("Could not be read");
    // Zero rows other than Unchanged are left out
    expect(text).not.toContain("Missing");
    expect(text).toContain("By user");
    expect(text).toContain("jo");
    expect(text).toContain("/photos/mina/IMG_1.jpg");
    expect(text).toContain("2 named faces removed");
    expect(text).toContain("The photos of the changed files are read again by 2 scans.");
    expect(container.querySelectorAll("th[scope=row]").length).toBe(5);
  });

  it("says when every file matched", async () => {
    const nothing = { ...counts, unreadable: 0, new_picture: 0, same_picture: 0, uncomparable: 0 };
    await renderResults({ ...nothing, users: [{ user_id: 1, username: "mina", ...nothing }], changed: [], rescans: 0 });

    const text = container.textContent ?? "";
    expect(text).toContain("Every file matches");
    expect(text).not.toContain("By user");
    expect(text).not.toContain("Changed files");
  });
});

describe("parseCheckFileContentsResult", () => {
  it("is null for a result of another shape, such as a failed run's", () => {
    expect(parseCheckFileContentsResult({ status: "failed", error: "boom" })).toBeNull();
    expect(parseCheckFileContentsResult(null)).toBeNull();
  });
});
