import React, { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

type Size = Readonly<{ width: number; height: number }>;

function measureContentBox(element: HTMLElement): Size {
  const style = window.getComputedStyle(element);
  const px = (value: string) => Number.parseFloat(value) || 0;
  return {
    width: element.offsetWidth - px(style.paddingLeft) - px(style.paddingRight),
    height: element.offsetHeight - px(style.paddingTop) - px(style.paddingBottom),
  };
}

/**
 * Hands its children the size of its parent's content box, as react-virtualized's AutoSizer did.
 * It renders a zero-size box, so a child sized from the measurement never props the parent open:
 * a flex item can still shrink when the window does. Renders nothing until the parent has a size.
 */
export function AutoSizer({ children }: Readonly<{ children: (size: Size) => ReactNode }>) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return undefined;
    const update = () => {
      const next = measureContentBox(parent);
      setSize(prev => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    update();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ overflow: "visible", width: 0, height: 0 }}>
      {size.width > 0 && size.height > 0 ? children(size) : null}
    </div>
  );
}
