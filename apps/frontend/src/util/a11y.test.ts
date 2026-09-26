import { describe, expect, it, vi } from "vitest";
import { buttonRoleProps } from "./a11y";

const keyEvent = (key: string, sameTarget = true) => {
  const target = {};
  return {
    key,
    target,
    currentTarget: sameTarget ? target : {},
    preventDefault: vi.fn(),
  } as unknown as React.KeyboardEvent<HTMLElement>;
};

describe("buttonRoleProps", () => {
  it("exposes the element as a focusable button that clicks activate", () => {
    const onActivate = vi.fn();
    const props = buttonRoleProps(onActivate);

    expect(props.role).toBe("button");
    expect(props.tabIndex).toBe(0);
    props.onClick();
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it.each(["Enter", " "])("activates on %j and stops the default action", key => {
    const onActivate = vi.fn();
    const event = keyEvent(key);

    buttonRoleProps(onActivate).onKeyDown(event);

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("ignores other keys and keys aimed at a nested control", () => {
    const onActivate = vi.fn();
    const props = buttonRoleProps(onActivate);

    props.onKeyDown(keyEvent("a"));
    props.onKeyDown(keyEvent("Enter", false));

    expect(onActivate).not.toHaveBeenCalled();
  });
});
