/**
 * The single sign-on group of the Site Settings card (#2725): the OIDC_* switches save like the
 * other site settings, and what keeps SSO from working shows under the switch it affects.
 */
import type { SiteSettings, SiteSettingsUpdate } from "@librephotos/api-client";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { SsoSettingsGroup } from "./SsoSettings";

const BASE: SiteSettings = {
  allow_registration: false,
  allow_upload: true,
  skip_patterns: "",
  map_api_key: "",
  map_api_provider: "exiftool",
  map_tile_provider: "photoprism",
  captioning_model: "lfm2_vl_450m",
  tagging_model: "openclip_vitb32",
  ocr_model: "none",
  face_recognition_model: "buffalo_sc",
  nextcloud_enabled: false,
  auto_create_user_directory: false,
  email_configured: true,
  oidc_enabled: true,
  oidc_button_label: "Sign in with Keycloak",
  oidc_allow_signup: false,
  sso_providers: [{ name: "Keycloak", on_this_site: true }],
  public_url_configured: true,
};

const mocks = vi.hoisted(() => ({
  save: vi.fn<(input: SiteSettingsUpdate) => void>(),
  query: { data: undefined as SiteSettings | undefined, dataUpdatedAt: 1 },
}));

vi.mock("../../api_client/settings/hooks", () => ({ useGetSettingsQuery: () => mocks.query }));
vi.mock("./useSaveSiteSettings", () => ({ useSaveSiteSettings: () => mocks.save }));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  mocks.save.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(settings: Partial<SiteSettings>) {
  mocks.query.data = { ...BASE, ...settings };
  act(() =>
    root.render(
      <MantineProvider env="test">
        <SsoSettingsGroup />
      </MantineProvider>
    )
  );
}

function switchLabelled(text: string): HTMLInputElement {
  return defined(
    Array.from(container.querySelectorAll("input")).find(input =>
      Array.from(input.labels ?? []).some(label => label.textContent?.startsWith(text))
    ),
    `the input labelled ${text}`
  );
}

function labelInput(): HTMLInputElement {
  return switchLabelled("Button label");
}

function typeLabel(value: string) {
  const input = labelInput();
  const setter = defined(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set, "value setter");
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("SsoSettingsGroup", () => {
  it("is hidden for a backend without the switches", () => {
    render({ oidc_enabled: undefined });
    expect(container.querySelector("input")).toBeNull();
  });

  it("posts oidc_enabled when the switch is toggled", () => {
    render({ oidc_enabled: true });
    act(() => switchLabelled("Show the single sign-on button").click());
    expect(mocks.save).toHaveBeenCalledWith({ oidc_enabled: false });
  });

  it("posts oidc_allow_signup when sign-ups are toggled", () => {
    render({ oidc_allow_signup: false });
    act(() => switchLabelled("Allow sign-ups over single sign-on").click());
    expect(mocks.save).toHaveBeenCalledWith({ oidc_allow_signup: true });
  });

  it("keeps the label and sign-ups usable while single sign-on is off", () => {
    // An admin may set them up before turning it on.
    render({ oidc_enabled: false });
    expect(labelInput().disabled).toBe(false);
    act(() => switchLabelled("Allow sign-ups over single sign-on").click());
    expect(mocks.save).toHaveBeenCalledWith({ oidc_allow_signup: true });
  });

  it("saves the trimmed label on blur, and nothing when it did not change", () => {
    render({});
    typeLabel("  Sign in with Authentik ");
    act(() => {
      labelInput().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(mocks.save).toHaveBeenCalledWith({ oidc_button_label: "Sign in with Authentik" });

    mocks.save.mockReset();
    typeLabel("Sign in with Keycloak ");
    act(() => {
      labelInput().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("saves on Enter", () => {
    render({});
    typeLabel("Sign in");
    act(() => {
      labelInput().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(mocks.save).toHaveBeenCalledWith({ oidc_button_label: "Sign in" });
  });

  it("refuses a label longer than the server keeps", () => {
    render({});
    typeLabel("x".repeat(65));
    act(() => {
      labelInput().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(container.textContent).toContain("At most 64 characters.");
    expect(container.textContent).toContain("65 / 64");
  });

  it("warns that sign-ups stay closed without email", () => {
    render({ email_configured: false });
    expect(container.textContent).toContain("Sign-ups over SSO stay closed until email is set up");
    expect(container.querySelector('a[href="#admin-email"]')).not.toBeNull();
  });

  it("warns when no provider is attached to this site", () => {
    render({ sso_providers: [{ name: "Authentik", on_this_site: false }] });
    expect(container.textContent).toContain("No identity provider is set up for this site");
    expect(container.textContent).toContain("Authentik (not attached to this site)");
  });

  it("warns when the public URL is missing", () => {
    render({ public_url_configured: false });
    expect(container.textContent).toContain("FRONTEND_BASE_URL=https://photos.example.com");
  });

  it("does not warn about a setup that cannot matter while SSO is off", () => {
    render({ oidc_enabled: false, sso_providers: [], public_url_configured: false });
    expect(container.textContent).not.toContain("FRONTEND_BASE_URL");
    expect(container.textContent).not.toContain("No identity provider is set up for this site");
    expect(container.textContent).toContain("No identity provider yet.");
  });

  it("lists the providers with links to the Django admin and the guide", () => {
    render({});
    expect(container.textContent).toContain("Providers: Keycloak.");
    expect(container.querySelector('a[href="/api/django-admin/socialaccount/socialapp/"]')).not.toBeNull();
    expect(
      container.querySelector('a[href="https://docs.librephotos.com/docs/user-guide/settings/single-sign-on"]')
    ).not.toBeNull();
  });
});
