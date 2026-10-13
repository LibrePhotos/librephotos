/**
 * The error state a list shows when its request failed (#2221): it names the failure, its Retry
 * asks the server again, and it is announced (role="alert"), at both sizes. `useListFailure` only
 * reports a failure while no data is on screen: a failed background refetch keeps the list.
 */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { defined } from "../../util/defined.test-utils";
import { ErrorState } from "./ErrorState";
import { ListEmptyState } from "./ListEmptyState";
import { useListFailure, type ListFailure } from "./useListFailure";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => {},
}));

let root: Root;
let container: HTMLDivElement;

const render = async (element: React.ReactNode) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<MantineProvider>{element}</MantineProvider>);
  });
};

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

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function retryButton() {
  return defined([...container.querySelectorAll("button")].find(b => b.textContent === i18n.t("errorstate.retry")));
}

describe("ErrorState", () => {
  it.each([false, true])("says the list failed and retries on click (compact: %s)", async compact => {
    const onRetry = vi.fn<() => void>();
    await render(<ErrorState failure={{ onRetry, retrying: false }} compact={compact} />);

    expect(container.querySelector("[role=alert]")?.textContent).toContain(i18n.t("errorstate.title"));
    expect(container.textContent).toContain(i18n.t("errorstate.description"));
    await act(async () => retryButton().click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("takes no second click while the retry is out", async () => {
    await render(<ErrorState failure={{ onRetry: () => {}, retrying: true }} />);

    expect(retryButton().hasAttribute("data-loading")).toBe(true);
  });
});

describe("ListEmptyState", () => {
  it("is the empty state until the list failed", async () => {
    await render(<ListEmptyState failure={undefined} title="No tags yet" description="Add one" />);
    expect(container.textContent).toContain("No tags yet");
    await act(async () => root.unmount());
    container.remove();

    await render(
      <ListEmptyState failure={{ onRetry: () => {}, retrying: false }} title="No tags yet" description="Add one" />
    );
    expect(container.textContent).not.toContain("No tags yet");
    expect(container.textContent).toContain(i18n.t("errorstate.title"));
  });
});

describe("useListFailure", () => {
  type Query = Parameters<typeof useListFailure>[0];
  const refetch = vi.fn<() => Promise<unknown>>(() => Promise.resolve());

  async function failureOf(query: Query) {
    let failure: ListFailure | undefined;
    function Probe() {
      failure = useListFailure(query);
      return null;
    }
    await render(<Probe />);
    return failure;
  }

  it("reports a request that failed before any data came", async () => {
    const failure = await failureOf({ isError: true, isFetching: false, data: undefined, refetch });
    defined(failure).onRetry();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the list when only a background refetch failed", async () => {
    expect(await failureOf({ isError: true, isFetching: false, data: [], refetch })).toBeUndefined();
  });

  it("reports nothing while the request is fine", async () => {
    expect(await failureOf({ isError: false, isFetching: true, data: undefined, refetch })).toBeUndefined();
  });
});
