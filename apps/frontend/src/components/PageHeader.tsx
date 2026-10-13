import { Group, Loader, Stack, Text, Title } from "@mantine/core";
import type { TablerIcon } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { PAGE_GUTTER, PAGE_HEADER_ICON_SIZE } from "../uiConstants";

type Props = Readonly<{
  icon: TablerIcon;
  iconColor?: string;
  // ReactNode so the photo lists can put their view switcher menu here
  title: ReactNode;
  subtitle?: ReactNode;
  // Right side of the header. Wraps below the title on a phone.
  actions?: ReactNode;
  // Spinner next to the title while the page's data is loading
  loading?: boolean;
  // 2 for a header nested under its page's own PageHeader (a photo list inside a tab), so the
  // page keeps one h1. It looks the same either way.
  titleOrder?: 1 | 2;
}>;

/**
 * The header of every routed page: the one h1 on the page, with the icon beside it (an h2 when
 * nested under another one, `titleOrder`).
 * The title and icon never change size from one page to the next, so switching pages does not
 * make the header jump.
 */
export function PageHeader({
  icon: Icon,
  iconColor,
  title,
  subtitle,
  actions,
  loading = false,
  titleOrder = 1,
}: Props) {
  return (
    <Group justify="space-between" align="flex-start" gap="xs" p={PAGE_GUTTER} mb={10}>
      {/* The text column takes the free space; the icon never shrinks, so a long title cannot squeeze it */}
      <Group gap="sm" wrap="nowrap" align="center" style={{ flex: "1 1 260px", minWidth: 0 }}>
        <Icon size={PAGE_HEADER_ICON_SIZE} stroke={1.5} color={iconColor} style={{ flexShrink: 0 }} />
        <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
          <Title order={titleOrder} size="h2" ta="left" style={{ overflowWrap: "anywhere" }}>
            {title}
            {loading ? <Loader size={20} ml={8} style={{ verticalAlign: "middle" }} /> : null}
          </Title>
          {subtitle ? (
            // A div, not Text: callers may put block content (the photo counts) in it
            <Text component="div" c="dimmed" size="sm">
              {subtitle}
            </Text>
          ) : null}
        </Stack>
      </Group>
      {actions ? (
        <Group gap="sm" justify="flex-end" style={{ marginLeft: "auto" }}>
          {actions}
        </Group>
      ) : null}
    </Group>
  );
}
