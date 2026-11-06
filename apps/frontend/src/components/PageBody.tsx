import type { StackProps } from "@mantine/core";
import { Stack } from "@mantine/core";
import { PAGE_GUTTER, PAGE_GUTTER_PX } from "../uiConstants";

type Props = Readonly<Omit<StackProps, "p" | "px" | "pl" | "pr" | "ps" | "pe">>;

/**
 * A page's content below its PageHeader, inset by the page gutter (PAGE_GUTTER) and with the same
 * space at the bottom. A route sets no outer padding of its own (src/architecture/pageGutter.test.ts);
 * photo grids (PhotoListView) and tile grids (TileGrid) keep the gutter themselves.
 */
export function PageBody({ children, ...props }: Props) {
  return (
    <Stack px={PAGE_GUTTER_PX} pb={PAGE_GUTTER} {...props}>
      {children}
    </Stack>
  );
}
