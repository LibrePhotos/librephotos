/**
 * The prompt queue's one transition: which dialog shows next, given the one showing, the ones
 * waiting and whether files upload.
 */
import { describe, expect, it } from "vitest";
import { createPromptQueue, nextDialog, type PromptId } from "./promptQueue";

const waiting = (...ids: PromptId[]) => new Set<PromptId>(ids);

describe("nextDialog", () => {
  it("ranks the thank-you dialog before the error reporting question before Rewind", () => {
    expect(nextDialog(null, waiting("rewind", "errorReporting", "thankYou"), true)).toBe("thankYou");
    expect(nextDialog(null, waiting("rewind", "errorReporting"), true)).toBe("errorReporting");
  });

  it("keeps the dialog that shows until it no longer waits", () => {
    expect(nextDialog("rewind", waiting("rewind", "thankYou"), true)).toBe("rewind");
    expect(nextDialog("rewind", waiting("rewind", "thankYou"), false)).toBe("rewind");
    expect(nextDialog("rewind", waiting("thankYou"), true)).toBe("thankYou");
  });

  it("opens nothing by itself while files upload, but what the user opened", () => {
    expect(nextDialog(null, waiting("thankYou"), false)).toBeNull();
    expect(nextDialog(null, waiting("thankYou", "rewindOpened"), false)).toBe("rewindOpened");
  });
});

describe("createPromptQueue", () => {
  it("shows What's new's card only while no dialog shows and no file uploads", async () => {
    const queue = createPromptQueue(true);
    queue.want("whatsNewCard", true);
    await Promise.resolve();
    expect(queue.turn("whatsNewCard")).toBe(true);

    queue.want("errorReporting", true);
    await Promise.resolve();
    expect(queue.turn("errorReporting")).toBe(true);
    expect(queue.turn("whatsNewCard")).toBe(false);

    queue.want("errorReporting", false);
    queue.setQuiet(false);
    await Promise.resolve();
    expect(queue.turn("whatsNewCard")).toBe(false);
  });

  it("ranks the prompts that became due together, whichever registered first", async () => {
    const queue = createPromptQueue(true);
    queue.want("errorReporting", true);
    queue.want("thankYou", true);
    await Promise.resolve();
    expect(queue.turn("thankYou")).toBe(true);
    expect(queue.turn("errorReporting")).toBe(false);
  });
});
