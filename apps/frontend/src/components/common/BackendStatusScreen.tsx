import { POLL_BACKEND_STATUS_MS } from "@librephotos/api-client";
import {
  Alert,
  Box,
  Button,
  Group,
  Image,
  Loader,
  Stack,
  Text,
  ThemeIcon,
  Title,
  useComputedColorScheme,
  type MantineColor,
} from "@mantine/core";
import { useDocumentTitle, useInterval } from "@mantine/hooks";
import { IconAlertOctagon, IconAlertTriangle, IconHourglassHigh, IconPlugConnectedX } from "@tabler/icons-react";
import type { ParseKeys } from "i18next";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BackendStatus } from "../../api_client/server";
import { describeDuration } from "../../util/dateUtils";
import { isFailedScreen, SLOW_AFTER_MS, statusScreen, type StatusScreen } from "./backendStatusCopy";
import { BackendStatusFailure } from "./BackendStatusFailure";
import classes from "./BackendStatusGate.module.css";

type Down = Extract<BackendStatus, { kind: "down" }>;

type Look = { color: MantineColor; icon: React.ReactNode; tab: ParseKeys };

const LOOKS: Record<StatusScreen, Look> = {
  updating: { color: "blue", icon: <Loader size="md" />, tab: "backendStatus.updating.tab" },
  starting: { color: "blue", icon: <Loader size="md" />, tab: "backendStatus.starting.tab" },
  unreachable: { color: "gray", icon: <IconPlugConnectedX size={40} />, tab: "backendStatus.unreachable.tab" },
  "failed.E001": { color: "orange", icon: <IconAlertTriangle size={40} />, tab: "backendStatus.failed.tab" },
  "failed.E002": { color: "orange", icon: <IconAlertTriangle size={40} />, tab: "backendStatus.failed.tab" },
  "failed.unknown": { color: "red", icon: <IconAlertOctagon size={40} />, tab: "backendStatus.failed.tab" },
};

/** The clock the elapsed time and the countdown read, a second at a time. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useInterval(() => setNow(Date.now()), 1000, { autoInvoke: true });
  return now;
}

/** The tab says what is going on; the title the page had comes back with the app. */
function useStatusTitle(title: string) {
  useLayoutEffect(() => {
    const previous = document.title;
    return () => {
      document.title = previous;
    };
  }, []);
  useDocumentTitle(title);
}

type PollLineProps = Readonly<{ status: Down; screen: StatusScreen; now: number; onCheckNow: () => void }>;

/** How long it has been, when the next check comes, and Check now. */
function PollLine({ status, screen, now, onCheckNow }: PollLineProps) {
  const { t } = useTranslation();
  // At least a second: a duration of 0 reads as nothing at all ("Updating for").
  const elapsed = describeDuration(Math.max(1, Math.floor((now - status.since) / 1000)));
  const nextCheck = Math.ceil((status.checkedAt + POLL_BACKEND_STATUS_MS - now) / 1000);
  return (
    <Stack gap={4} align="center">
      {(screen === "updating" || screen === "starting") && (
        <Text size="xs" c="dimmed">
          {t("backendStatus.elapsed.updating", { duration: elapsed })}
        </Text>
      )}
      {screen === "unreachable" && (
        <Text size="xs" c="dimmed">
          {t("backendStatus.elapsed.waiting", { duration: elapsed })}
        </Text>
      )}
      <Group gap={4} justify="center">
        <Text size="xs" c="dimmed">
          {nextCheck > 0 ? t("backendStatus.nextCheck", { seconds: nextCheck }) : t("backendStatus.checking")}
        </Text>
        <Button variant="subtle" size="compact-xs" onClick={onCheckNow}>
          {t("backendStatus.checkNow")}
        </Button>
      </Group>
    </Stack>
  );
}

type BackendStatusScreenProps = Readonly<{ status: Down; onCheckNow: () => void }>;

/**
 * "LibrePhotos is updating", "is not answering" or "the update could not finish" (#2310): one
 * full-page screen in place of the login or the app while the server does not serve. The words
 * carry the state, so the spinner is decoration; failures are an alert, the rest a status.
 */
export function BackendStatusScreen({ status, onCheckNow }: BackendStatusScreenProps) {
  const { t } = useTranslation();
  const colorScheme = useComputedColorScheme();
  const now = useNow();
  const heading = useRef<HTMLHeadingElement>(null);
  const screen = statusScreen(status.readiness);
  const failed = status.readiness.state === "failed";
  const { color, icon, tab } = LOOKS[screen];
  const waitedLong = !failed && now - status.since >= SLOW_AFTER_MS;

  useStatusTitle(t(tab));
  // The page under it went away: put keyboard and screen reader users on the news.
  useEffect(() => heading.current?.focus(), []);

  return (
    <Box className={classes.screen} role={failed ? "alert" : "status"} aria-live="polite">
      <Stack align="center" gap="md" maw={520} mx="auto" px="md" pt={80} pb="xl">
        <Group gap="xs" justify="center">
          {/* Decorative: the name is written right next to it */}
          <Image h={56} w={56} fit="contain" src={colorScheme === "dark" ? "/logo-white.png" : "/logo.png"} alt="" />
          <Text fw={700} size="lg">
            {t("login.name")}
          </Text>
        </Group>
        <ThemeIcon size={80} radius="xl" variant="light" color={color} mt="md">
          {icon}
        </ThemeIcon>
        <Title order={2} ta="center" tabIndex={-1} ref={heading} className={classes.heading}>
          {t(`backendStatus.${screen}.title`)}
        </Title>
        <Text c="dimmed" ta="center">
          {t(`backendStatus.${screen}.text`)}
        </Text>
        {waitedLong && (
          <Alert color="gray" variant="light" icon={<IconHourglassHigh size={18} />} w="100%">
            {t(screen === "unreachable" ? "backendStatus.unreachable.long" : "backendStatus.slow")}
          </Alert>
        )}
        {isFailedScreen(screen) && <BackendStatusFailure status={status} screen={screen} />}
        <PollLine status={status} screen={screen} now={now} onCheckNow={onCheckNow} />
      </Stack>
    </Box>
  );
}
