/** VirtualList mounts only the rows in and near its viewport, each keyed and positioned by its row. */
import { MantineProvider } from "@mantine/core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { setUpMantineDom } from "../modals/confirmModal.test-utils";
import { VirtualList } from "./VirtualList";

beforeAll(setUpMantineDom);

afterEach(() => {
  document.body.innerHTML = "";
});

async function renderList(count: number) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <MantineProvider env="test">
        <VirtualList
          count={count}
          estimateSize={() => 30}
          getItemKey={index => `row-${index}`}
          renderItem={index => <span className="item">row {index}</span>}
          height={300}
          overscan={2}
          aria-label="Rows"
        />
      </MantineProvider>
    );
  });
  return container;
}

describe("VirtualList", () => {
  it("renders the rows that fit the viewport, not all of them", async () => {
    const container = await renderList(1000);
    const rows = container.querySelectorAll(".item");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(100);
    expect(rows[0]?.textContent).toBe("row 0");
  });

  it("names its scroll region and sizes it", async () => {
    const container = await renderList(3);
    const region = container.querySelector<HTMLElement>('[role="region"]');
    expect(region?.getAttribute("aria-label")).toBe("Rows");
    expect(region?.style.height).toBe("300px");
    expect(container.querySelectorAll(".item")).toHaveLength(3);
  });
});
