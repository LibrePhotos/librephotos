/**
 * The login page says why single sign-on failed when the backend bounces back with
 * `?sso_error=<reason>`, including failures at the identity provider (#2724).
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import { SsoErrorAlert } from "./SsoErrorAlert";

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement | undefined;

beforeAll(async () => {
  // jsdom has no matchMedia, MantineProvider needs it
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

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  window.history.replaceState(null, "", "/login");
});

function renderAt(search: string): HTMLDivElement {
  window.history.replaceState(null, "", `/login${search}`);
  const host = document.createElement("div");
  document.body.appendChild(host);
  container = host;
  root = createRoot(host);
  act(() =>
    root?.render(
      <MantineProvider env="test">
        <SsoErrorAlert />
      </MantineProvider>
    )
  );
  return host;
}

describe("SsoErrorAlert", () => {
  it("renders nothing without an sso_error", () => {
    expect(renderAt("").querySelector('[role="alert"]')).toBeNull();
  });

  it("says the sign-in was cancelled at the identity provider", () => {
    const text = renderAt("?sso_error=provider_cancelled").textContent;
    expect(text).toContain("Could not sign in with single sign-on");
    expect(text).toContain("Sign-in was cancelled at your identity provider.");
  });

  it("names a shared email address", () => {
    expect(renderAt("?sso_error=email_ambiguous").textContent).toContain(
      "More than one LibrePhotos account uses this email address."
    );
  });
});
