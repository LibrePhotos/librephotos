import { PhotoOrder } from "@librephotos/api-client";
import { Box, Menu, SegmentedControl, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { DisabledReason } from "../common/DisabledReason";

const isPhotoOrder = (value: string): value is PhotoOrder => PhotoOrder.safeParse(value).success;

type Props = Readonly<{
  order: PhotoOrder;
  onChange: (order: PhotoOrder) => void;
  /** An event: it always reads oldest first, so the control shows that and says why it is fixed. */
  eventOrder: boolean;
}>;

/**
 * The Order section at the top of the photo display menu (#2712): newest or oldest day first, by
 * date taken, saved on the user and followed by every date-grouped photo list but events.
 */
export function PhotoOrderSection({ order, onChange, eventOrder }: Props) {
  const { t } = useTranslation();
  const control = (
    <SegmentedControl
      size="xs"
      fullWidth
      aria-label={t("photodisplay.order")}
      value={eventOrder ? "oldest" : order}
      onChange={value => {
        if (!eventOrder && isPhotoOrder(value)) onChange(value);
      }}
      data={[
        { value: "newest", label: t("photodisplay.newestFirst") },
        { value: "oldest", label: t("photodisplay.oldestFirst") },
      ]}
    />
  );
  return (
    <>
      <Menu.Label>{t("photodisplay.order")}</Menu.Label>
      <Box p="xs">
        <Stack gap={6}>
          {eventOrder ? <DisabledReason reason={t("photodisplay.orderEvents")}>{control}</DisabledReason> : control}
          <Text size="xs" c="dimmed">
            {t("photodisplay.orderHint")}
          </Text>
        </Stack>
      </Box>
      <Menu.Divider />
    </>
  );
}
