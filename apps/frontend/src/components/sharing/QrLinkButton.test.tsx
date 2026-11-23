import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { expectDisabledWithReason } from "../common/disabledReason.test-utils";
import { QrLinkButton } from "./QrLinkButton";
import { qrSquares, qrSvgDataUrl } from "./qrMatrix";

const SHARE_URL = "https://photos.example/public/p/abcdefghijkl";
let root: Root | undefined;

beforeAll(async () => {
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
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
});

async function renderButton(props: Partial<React.ComponentProps<typeof QrLinkButton>> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    defined(root).render(
      <MantineProvider env="test">
        <QrLinkButton url={SHARE_URL} {...props} />
      </MantineProvider>
    );
  });
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t("sharing.showQrCode")}"]`);
  return defined(button);
}

function qrDialog(): Element | null {
  return document.querySelector(`[role="dialog"][aria-label="${i18n.t("sharing.qrCode")}"]`);
}

describe("QrLinkButton", () => {
  it("is a named button that says it opens a dialog, closed at first", async () => {
    const button = await renderButton();

    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(qrDialog()).toBeNull();
  });

  it("opens the code of the full link with a translated label, and closes it again", async () => {
    const button = await renderButton();

    await act(async () => button.click());

    const dialog = defined(qrDialog());
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const image = defined(dialog.querySelector('svg[role="img"]'));
    expect(image.getAttribute("aria-label")).toBe(i18n.t("sharing.qrCode"));
    expect(image.querySelector("path")?.getAttribute("d")).toBe(qrSquares(SHARE_URL).path);
    expect(dialog.textContent).toContain(i18n.t("sharing.qrCodeHint"));
    const { side } = qrSquares(SHARE_URL);
    const width = Number(image.getAttribute("width"));
    expect(width % side).toBe(0);
    expect(width).toBeLessThanOrEqual(176);
    expect(width).toBeGreaterThan(176 - side);

    await act(async () => button.click());

    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("downloads the same code as an SVG file", async () => {
    const button = await renderButton();

    await act(async () => button.click());

    const download = defined(qrDialog()?.querySelector("a[download]"));
    expect(download.textContent).toBe(i18n.t("sharing.downloadQrCode"));
    expect(download.getAttribute("download")).toBe("qr-code.svg");
    expect(download.getAttribute("href")).toBe(qrSvgDataUrl(qrSquares(SHARE_URL)));
  });

  it("closes on Escape from inside the dialog", async () => {
    const button = await renderButton();
    await act(async () => button.click());
    const download = defined(qrDialog()?.querySelector<HTMLElement>("a[download]"));

    download.focus();
    await act(async () => {
      download.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("says why there is no code while the link is still being made", async () => {
    const reason = i18n.t("sharing.generating");
    const button = await renderButton({ url: "", reason });

    expectDisabledWithReason(button, reason);
    await act(async () => button.click());

    expect(qrDialog()).toBeNull();
  });
});
