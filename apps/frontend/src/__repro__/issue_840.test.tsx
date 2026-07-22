/**
 * Repro for https://github.com/LibrePhotos/librephotos/issues/840
 *
 *   "With latest library dashboard with french language (and maybe more long languages)
 *    buttons are too small or non responsive"
 *   -> "Can we add some unitary test to make it sure it fit all the language we have?"
 *
 * The Library page (src/components/settings/Library.tsx, introduced by the
 * "library UI rework" PR librephotos-frontend#173 the reporter points at) puts every
 * action button into `<Grid.Col span={{ base: 12, sm: 2 }}>` together with
 * `<Button fullWidth>`.  Mantine turns that into a hard `max-width: 16.6667%` cap on the
 * button's box from the `sm` breakpoint upwards, and `.mantine-Button-label` is
 * `white-space: nowrap; overflow: hidden`.
 *
 * The reserved width is therefore a constant that was chosen for the short English
 * labels ("Scan", "Generate", "Train", "Rescan", "Browse"). It does not grow, and the
 * label may neither wrap nor ellipsize - it is simply cut off. Every locale whose label
 * is longer than the English one loses text, which is exactly what the French
 * screenshots in the issue show.
 *
 * This test renders the real Library page twice - once in English, once in French - and
 * asserts that no localized button label ends up in a box that is both width-locked and
 * clip-only. It should pass once the action column is allowed to size to its content
 * (or the label is allowed to wrap).
 */
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Library } from "../components/settings/Library";
import i18n from "../i18n";

const stubs = vi.hoisted(() => ({
  noopMutation: { mutate: () => {}, mutateAsync: async () => {}, isPending: false },
  user: {
    id: 1,
    username: "admin",
    scan_directory: "/data",
    nextcloud_server_address: "https://nextcloud.example.com",
    nextcloud_username: "user",
    nextcloud_scan_directory: "/photos",
    stack_raw_jpeg: true,
  },
  worker: { queue_can_accept_job: true },
  auth: { access: { is_admin: true } },
  nextcloudDirs: { isFetching: false, isSuccess: true, isError: false, data: [] },
  siteSettings: { data: { nextcloud_enabled: true } },
  userList: { data: [] },
  countStats: { data: undefined },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: any) => <a href="/">{children}</a>,
}));
vi.mock("../api_client/api", () => ({ fetchClient: { get: () => {}, post: () => {} } }));
vi.mock("../api_client/apiClient", () => ({ serverAddress: "" }));
vi.mock("../api_client/auth/hooks", () => ({ useAccessToken: () => ({ data: stubs.auth }) }));
vi.mock("../api_client/faces", () => ({ useTrainFacesMutation: () => stubs.noopMutation }));
vi.mock("../api_client/folders/hooks/useFetchNextcloudDirsQuery", () => ({
  useFetchNextcloudDirsQuery: () => stubs.nextcloudDirs,
}));
vi.mock("../api_client/jobs/hooks", () => ({
  useGenerateAutoAlbumsMutation: () => stubs.noopMutation,
  useRescanPhotosMutation: () => stubs.noopMutation,
  useScanNextcloudPhotosMutation: () => stubs.noopMutation,
  useScanPhotosMutation: () => stubs.noopMutation,
  useWorkerQuery: () => ({ data: stubs.worker }),
}));
vi.mock("../api_client/photos/hooks", () => ({ useDeleteMissingPhotosMutation: () => stubs.noopMutation }));
vi.mock("../api_client/settings/hooks", () => ({ useGetSettingsQuery: () => stubs.siteSettings }));
vi.mock("../api_client/stats/hooks", () => ({ useFetchCountStatsQuery: () => stubs.countStats }));
vi.mock("../api_client/user/hooks", () => ({
  useFetchUserListQuery: () => stubs.userList,
  useUpdateUserMutation: () => stubs.noopMutation,
}));
vi.mock("../api_client/user/hooks/useCurrentUserSelfDetailsQuery", () => ({
  useCurrentUserSelfDetailsQuery: () => ({ data: stubs.user }),
}));
vi.mock("../service/notifications", () => ({ notification: new Proxy({}, { get: () => () => {} }) }));
vi.mock("../components/modals/ModalNextcloudScanDirectoryEdit", () => ({
  ModalNextcloudScanDirectoryEdit: () => null,
}));
vi.mock("../components/modals/ModalUserEdit", () => ({ ModalUserEdit: () => null }));

beforeAll(() => {
  // @ts-ignore - jsdom has no matchMedia, MantineProvider needs it
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  // @ts-ignore
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

type ActionButton = {
  label: string;
  /** value of --col-max-width that Mantine emits for this button's Grid.Col above `sm` */
  reservedWidth: string;
  /** true when the label may neither wrap nor scroll, i.e. anything too wide is cut off */
  clipsOverflow: boolean;
};

/** Reads the max-width Mantine generated for the Grid.Col that holds `button`. */
function reservedWidthOf(button: HTMLElement): string {
  const col = button.closest(".mantine-Grid-col") as HTMLElement | null;
  const generatedClass = col && Array.from(col.classList).find(c => c.startsWith("__m__"));
  if (!generatedClass) return "auto";
  const rules = Array.from(document.querySelectorAll("style"))
    .map(style => style.textContent ?? "")
    .filter(css => css.includes(`.${generatedClass}{`))
    .join("");
  // last declaration wins: the one inside the `@media (min-width: 48em)` block
  const widths = [...rules.matchAll(/--col-max-width:([^;}]+)/g)].map(m => m[1].trim());
  return widths.length ? widths[widths.length - 1] : "auto";
}

function collectActionButtons(container: HTMLElement): ActionButton[] {
  return Array.from(container.querySelectorAll<HTMLElement>("button"))
    .map(button => {
      const label = button.querySelector<HTMLElement>(".mantine-Button-label");
      if (!label || !label.textContent?.trim()) return null;
      const css = getComputedStyle(label);
      return {
        label: label.textContent.trim(),
        reservedWidth: reservedWidthOf(button),
        clipsOverflow: css.whiteSpace === "nowrap" && css.overflow === "hidden" && css.textOverflow !== "ellipsis",
      };
    })
    .filter((b): b is ActionButton => b !== null);
}

async function renderLibraryIn(language: string) {
  await act(async () => {
    await i18n.changeLanguage(language);
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MantineProvider>
        <Library />
      </MantineProvider>
    );
  });
  const buttons = collectActionButtons(container);
  await act(async () => {
    root.unmount();
  });
  container.remove();
  return buttons;
}

describe("issue #840 - library dashboard buttons in long languages", () => {
  it("reserves room for the localized label of every action button", async () => {
    const english = await renderLibraryIn("en");
    const french = await renderLibraryIn("fr");

    expect(french).toHaveLength(english.length);

    // A button whose box is pinned to a fixed fraction of the row *and* whose label is
    // clipped can only ever show as much text as the English label needed. Anything
    // longer is cut off - the "buttons are too small" symptom from the issue.
    const truncated = french
      .map((fr, i) => ({ french: fr.label, english: english[i].label, box: fr }))
      .filter(
        ({ french: frLabel, english: enLabel, box }) =>
          frLabel.length > enLabel.length && box.clipsOverflow && box.reservedWidth.endsWith("%")
      )
      .map(({ french: frLabel, english: enLabel, box }) => ({
        control: enLabel,
        localizedLabel: frLabel,
        reservedWidth: box.reservedWidth,
      }));

    expect(truncated).toEqual([]);
  });
});
