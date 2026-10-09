/**
 * - /admin showed a bare, untranslated "Unauthorized" to everyone while the
 *   profile loaded, so admins saw it flash on every reload.
 * - "Delete all auto created albums" deleted every event album on one click.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminPage } from "./AdminPage";

type SelfDetailsResult = { data: { is_superuser: boolean } | undefined; isPending: boolean };

const mocks = vi.hoisted(() => {
  const selfDetails: SelfDetailsResult = { data: undefined, isPending: true };
  return {
    selfDetails,
    deleteAll: vi.fn<(variables: undefined, options?: { onSettled?: () => void }) => void>(),
  };
});

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => () => {} }));
vi.mock("../../api_client/albums/hooks", () => ({
  useDeleteAllAutoAlbumsMutation: () => ({ mutate: mocks.deleteAll, isPending: false }),
}));
vi.mock("../../api_client/server/hooks", () => ({ useFetchServerStatsQuery: () => ({ data: {}, isLoading: false }) }));
vi.mock("../../api_client/user/hooks", () => ({ useFetchUserListQuery: () => ({ data: [], isFetching: false }) }));
vi.mock("../../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => mocks.selfDetails,
}));
vi.mock("../../i18n", () => ({ i18nResolvedLanguage: () => "en" }));
vi.mock("../job/JobList", () => ({ JobList: () => null }));
vi.mock("../modals/ModalUserDelete", () => ({ ModalUserDelete: () => null }));
vi.mock("../modals/ModalUserEdit", () => ({ ModalUserEdit: () => null }));
vi.mock("./ServerLogsCard", () => ({ ServerLogsCard: () => null }));
vi.mock("./ServiceList", () => ({ ServiceList: () => null }));
vi.mock("./SiteSettings", () => ({ SiteSettings: () => null }));

beforeAll(() => {
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
});

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  mocks.deleteAll.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(
      // No transitions, so the confirmation shows without waiting for animation frames.
      <MantineProvider theme={{ components: { Modal: { defaultProps: { transitionProps: { duration: 0 } } } } }}>
        <AdminPage />
      </MantineProvider>
    );
  });
}

const buttonByText = (text: string) =>
  [...document.body.querySelectorAll("button")].filter(button => button.textContent?.trim() === text);

describe("AdminPage", () => {
  it("shows neither the page nor a refusal while the profile loads", async () => {
    mocks.selfDetails = { data: undefined, isPending: true };
    await render();

    expect(container.textContent).not.toContain("adminarea.unauthorized");
    expect(container.textContent).not.toContain("adminarea.header");
  });

  it("explains the refusal to a non-admin and offers a way back", async () => {
    mocks.selfDetails = { data: { is_superuser: false }, isPending: false };
    await render();

    expect(container.textContent).toContain("adminarea.unauthorized");
    expect(container.textContent).toContain("adminarea.unauthorizeddescription");
    expect(buttonByText("publicalbum.goHome")).toHaveLength(1);
  });

  it("asks before deleting all auto created albums", async () => {
    mocks.selfDetails = { data: { is_superuser: true }, isPending: false };
    await render();

    const [trigger] = buttonByText("adminarea.delete");
    await act(async () => {
      trigger.click();
    });
    expect(mocks.deleteAll).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("adminarea.deleteallautoalbumsexplanation");

    const confirm = buttonByText("adminarea.delete").find(button => button !== trigger);
    if (!confirm) throw new Error("the confirmation has no delete button");
    await act(async () => {
      confirm.click();
    });
    expect(mocks.deleteAll).toHaveBeenCalledTimes(1);
  });
});
