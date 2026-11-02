import { Anchor, Button, Group, Modal, Paper, SimpleGrid, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconCheck as Check } from "@tabler/icons-react";
import { DateTime } from "luxon";
import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { useFetchCountStatsQuery } from "../../api_client/stats/hooks/useFetchCountStatsQuery";
import { TRANSLATE_LINK } from "../../uiConstants";
import { CLOUD_PRICES_CHECKED, librarySize, plansFor, planSize, usd } from "./cloudPrices";
import { SupportButtons } from "./SupportButtons";
import classes from "./ThankYouModal.module.css";

/** The Weblate link inside the footer's sentence. */
function TranslateLink({ children }: Readonly<{ children?: React.ReactNode }>) {
  return (
    <Anchor href={TRANSLATE_LINK} target="_blank" rel="noreferrer" size="xs">
      {children}
    </Anchor>
  );
}

type ThankYouModalProps = Readonly<{
  /** Closed, or one of its links opened: either way it is not shown again. */
  onClose: () => void;
}>;

function Stat({ value, label }: Readonly<{ value: string; label: string }>) {
  return (
    <Paper className={classes.stat} radius="md" p="sm">
      <Text fw={700} size="xl">
        {value}
      </Text>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Paper>
  );
}

/** What keeping the library in a commercial cloud would cost, plan for plan; nothing for a free tier. */
function CloudPrices({ bytes }: Readonly<{ bytes: number }>) {
  const { t, i18n } = useTranslation();
  const plans = plansFor(bytes);
  if ((plans[0]?.yearlyUsd ?? 0) === 0) return null;
  const locale = i18n.language;
  return (
    <Paper withBorder radius="md" className={classes.prices} data-testid="cloud-prices">
      <Group justify="space-between" gap="xs" className={classes.pricesHeader}>
        <Text size="sm" fw={600}>
          {t("support.thankyou.elsewhere", { size: librarySize(bytes, locale) })}
        </Text>
        <Text size="xs" c="dimmed">
          {t("support.listprices", {
            date: DateTime.fromISO(CLOUD_PRICES_CHECKED).toLocaleString({ month: "long", year: "numeric" }),
          })}
        </Text>
      </Group>
      {plans.map(plan => (
        <Group key={plan.provider} justify="space-between" className={classes.priceRow}>
          <Text size="sm">{`${plan.provider} ${planSize(plan.storageGb)}`}</Text>
          <Text size="sm" fw={600}>
            {t("support.peryear", { price: usd(plan.yearlyUsd, locale) })}
          </Text>
        </Group>
      ))}
      <Group justify="space-between" className={classes.ours}>
        <Text size="sm" fw={700} c="inherit">
          {t("support.thankyou.ours")}
        </Text>
        <Text size="sm" fw={700} c="inherit">
          {usd(0, locale)}
        </Text>
      </Group>
    </Paper>
  );
}

/**
 * Once, for an admin, after their first library is processed: what LibrePhotos did, what the same
 * storage costs elsewhere, and a request to star or sponsor the project. Closing it, or opening any
 * of its links, remembers that it was seen.
 */
export function ThankYouModal({ onClose }: ThankYouModalProps) {
  const { t, i18n } = useTranslation();
  const { data: stats } = useFetchCountStatsQuery();
  const number = new Intl.NumberFormat(i18n.language);
  return (
    <Modal
      opened
      onClose={onClose}
      centered
      size="lg"
      radius="md"
      title={
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon color="green" variant="light" radius="xl" size={36}>
            <Check size={20} />
          </ThemeIcon>
          <Text fw={700} size="lg">
            {t("support.thankyou.title")}
          </Text>
        </Group>
      }
      closeButtonProps={{ "aria-label": t("support.close") }}
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {t("support.thankyou.done")}
        </Text>
        {stats ? (
          <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="xs">
            <Stat value={number.format(stats.num_photos)} label={t("support.thankyou.photos")} />
            <Stat value={number.format(stats.num_people)} label={t("support.thankyou.people")} />
            {stats.num_places === undefined ? null : (
              <Stat value={number.format(stats.num_places)} label={t("support.thankyou.places")} />
            )}
          </SimpleGrid>
        ) : null}
        {stats?.library_bytes ? <CloudPrices bytes={stats.library_bytes} /> : null}
        <Text size="sm">{t("support.thankyou.ask")}</Text>
        <SupportButtons onAction={onClose} />
        <Group justify="space-between" wrap="nowrap" className={classes.footer}>
          <Text size="xs" c="dimmed">
            <Trans i18nKey="support.thankyou.footer" components={{ translate: <TranslateLink /> }} />
          </Text>
          <Button variant="default" onClick={onClose}>
            {t("support.close")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
