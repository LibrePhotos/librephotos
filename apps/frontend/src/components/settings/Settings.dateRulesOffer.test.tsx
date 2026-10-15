/**
 * #437: saved date rules only apply to photos scanned afterwards. Once changed rules are saved, the
 * date rules card offers to apply them to the photos already in the library; nothing runs until
 * the offer is clicked, and it can be closed.
 */
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { expectDisabledWithReason } from "../common/disabledReason.test-utils";
import { Settings } from "./Settings";

type SaveOptions = { onSuccess?: () => void; onError?: (error: unknown) => void };

const mocks = vi.hoisted(() => ({
  user: {} as Record<string, unknown>,
  mutate: vi.fn<(user: Record<string, unknown>, options?: SaveOptions) => void>(),
  applyDateRules: vi.fn<() => void>(),
  queueCanAcceptJob: true,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => async () => {},
  useLocation: ({ select }: { select: (location: { hash: string }) => string }) => select({ hash: "" }),
}));
vi.mock("../../api_client/auth", () => ({
  useAccessToken: () => ({ data: { access: { user_id: 1 } } }),
}));
vi.mock("../../api_client/settings", () => ({
  useFetchTimezonesQuery: () => ({ data: ["UTC"] }),
}));
vi.mock("../../api_client/user/hooks", () => ({
  useFetchUserSelfDetailsQuery: () => ({ data: mocks.user }),
  useUpdateUserMutation: () => ({ mutate: mocks.mutate, isPending: false }),
}));
vi.mock("../../api_client/jobs/hooks", () => ({
  useApplyDateRules: () => ({ start: mocks.applyDateRules, running: false }),
  useWorkerQuery: () => ({ data: { status: true, queue_can_accept_job: mocks.queueCanAcceptJob, job_detail: null } }),
}));
vi.mock("./ConfigBurstDetection", () => ({
  ConfigBurstDetection: ({ onChange }: { onChange: (rules: string) => void }) => (
    <button type="button" onClick={() => onChange('[{"id":2}]')}>
      edit-burst-rules
    </button>
  ),
}));
// The rule list is covered in ConfigDateTime.test.tsx; here a button stands in for an edit.
vi.mock("./ConfigDateTime", () => ({
  ConfigDateTime: ({ onChange, notice }: { onChange: (rules: string) => void; notice?: React.ReactNode }) => (
    <div>
      <button type="button" onClick={() => onChange('[{"id":1}]')}>
        edit-rules
      </button>
      {notice}
    </div>
  ),
}));
// Its own test: WriteExistingEditsRow.test.tsx.
vi.mock("./WriteExistingEditsRow", () => ({ WriteExistingEditsRow: () => null }));
vi.mock("./SaveChangesDialog", () => ({
  SaveChangesDialog: ({ opened, onSave }: { opened: boolean; onSave: () => void }) =>
    opened ? (
      <button type="button" onClick={onSave}>
        dialog-save
      </button>
    ) : null,
}));

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
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
  globalThis.ResizeObserver = class ResizeObserverStub implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

async function render() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MantineProvider>
          <Settings />
        </MantineProvider>
      </QueryClientProvider>
    );
  });
}

beforeEach(async () => {
  mocks.queueCanAcceptJob = true;
  mocks.user = {
    id: 1,
    username: "admin",
    email: "admin@example.com",
    confidence: 0.1,
    confidence_person: 0.9,
    confidence_unknown_face: 0.5,
    min_cluster_size: 0,
    min_samples: 1,
    cluster_selection_epsilon: 0.1,
    save_face_tags_to_disk: false,
    llm_settings: {},
    default_timezone: "UTC",
    default_timeline_filter: {},
    rating_mode: "favorite",
    datetime_rules: "[]",
    burst_detection_rules: "[]",
  };
  // The server takes the save; the next fetch returns what was saved.
  mocks.mutate.mockImplementation((user, options) => {
    mocks.user = { ...user };
    options?.onSuccess?.();
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await render();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.clearAllMocks();
});

function button(text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find(element => element.textContent === text);
  if (!found) throw new Error(`no button "${text}"`);
  return found;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
}

async function saveChangedRules() {
  await click(button("edit-rules"));
  await click(button("dialog-save"));
  await render();
}

const OFFER = "Your date rules changed";

describe("Apply date rules offer (#437)", () => {
  it("is not there before the rules were changed", () => {
    expect(container.textContent).not.toContain(OFFER);
  });

  it("appears once changed rules were saved, and starts the job from there", async () => {
    await saveChangedRules();

    expect(container.querySelector('[role="status"]')?.textContent).toContain(OFFER);
    await click(button("Apply to existing photos"));

    expect(mocks.applyDateRules).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain(OFFER);
  });

  it("does not appear when the save changed something else", async () => {
    await click(button("edit-burst-rules"));
    await click(button("dialog-save"));
    await render();

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain(OFFER);
  });

  it("can be closed without running anything", async () => {
    await saveChangedRules();

    const close = container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]');
    expect(close).not.toBeNull();
    if (close) await click(close);

    expect(container.textContent).not.toContain(OFFER);
    expect(mocks.applyDateRules).not.toHaveBeenCalled();
  });

  it("says why it cannot start while a job runs", async () => {
    mocks.queueCanAcceptJob = false;
    await saveChangedRules();

    const apply = button("Apply to existing photos");
    expectDisabledWithReason(apply, i18n.t("jobs.queuebusy.reason"));
    await click(apply);
    expect(mocks.applyDateRules).not.toHaveBeenCalled();
  });
});
