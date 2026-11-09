import { act } from "react";

/**
 * Opens the ⋮ of a face tile (PersonDetail) unless it is open, and returns its items. The menu
 * renders in place (no portal), so they are inside `container`.
 */
export async function openFaceMenu(container: HTMLElement): Promise<HTMLButtonElement[]> {
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-label^="Actions for"]');
  if (!trigger) throw new Error("the face has no actions menu");
  if (trigger.getAttribute("aria-expanded") !== "true") {
    await act(async () => {
      trigger.click();
    });
  }
  // Outside env="test" the dropdown mounts with its transition, a frame or two later.
  for (let frame = 0; frame < 20; frame++) {
    const items = container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    if (items.length > 0) return [...items];
    await act(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  }
  return [];
}

/** The item of a face's ⋮ whose text is `label`, with the menu opened. Throws when there is none. */
export async function faceMenuItem(container: HTMLElement, label: string): Promise<HTMLButtonElement> {
  const item = (await openFaceMenu(container)).find(candidate => candidate.textContent?.trim() === label);
  if (!item) throw new Error(`no "${label}" in the face's menu`);
  return item;
}
