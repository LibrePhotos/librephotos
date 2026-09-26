import {
  Box,
  Card,
  Grid,
  Group,
  HoverCard,
  Stack,
  Text,
  Title,
  Tooltip,
  UnstyledButton,
  VisuallyHidden,
} from "@mantine/core";
import {
  IconArrowRight as ArrowRight,
  IconChartLine as ChartLine,
  IconFaceId as FaceId,
  IconPhoto as Photo,
  IconQuestionMark as QuestionMark,
  IconSettingsAutomation as SettingsAutomation,
  IconTag as Tag,
  IconUsers as Users,
} from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { Trans, useTranslation } from "react-i18next";
import { useFetchCountStatsQuery } from "../api_client/stats/hooks";
import { COUNT_STATS_DEFAULTS } from "../api_client/stats/types";
import { i18nResolvedLanguage } from "../i18n";
import { formatCompactCount, formatCount } from "../util/formatCount";

// Below the `sm` breakpoint large counts are abbreviated (25123 -> "25.1K" in en) and
// the exact value is shown in a tooltip on hover, tap or keyboard focus. From `sm` up
// there is room for the full number, so it is shown directly without a tooltip.
// Screen readers always get the exact value via the visually hidden text.
// Pass `withTooltip={false}` inside another popover target (e.g. a HoverCard) so the
// two do not open together.
function Count({ value, withTooltip = true }: { value: number; withTooltip?: boolean }) {
  // Subscribe to language changes so the numbers are re-formatted for the new locale.
  useTranslation();
  const locale = i18nResolvedLanguage();
  const full = formatCount(value, locale);
  const compact = formatCompactCount(value, locale);

  if (compact === full) {
    return full;
  }

  const compactWithFullForScreenReaders = (
    <>
      <span aria-hidden="true">{compact}</span>
      <VisuallyHidden>{full}</VisuallyHidden>
    </>
  );

  return (
    <>
      <Box component="span" visibleFrom="sm">
        {full}
      </Box>
      <Box component="span" hiddenFrom="sm">
        {withTooltip ? (
          <Tooltip label={full} events={{ hover: true, focus: true, touch: true }}>
            <span tabIndex={0}>{compactWithFullForScreenReaders}</span>
          </Tooltip>
        ) : (
          compactWithFullForScreenReaders
        )}
      </Box>
    </>
  );
}

export function CountStats() {
  const { t } = useTranslation();
  const { data: countStats = COUNT_STATS_DEFAULTS } = useFetchCountStatsQuery();

  return (
    <Grid gutter="xs">
      {/* Photos & Days combined */}
      <Grid.Col span={{ base: 6, sm: 6, md: 3 }}>
        <Card withBorder p="xs">
          <Group justify="flex-start" gap="xs">
            <Photo size={40} strokeWidth={1} />
            <div>
              <Text c="dimmed" size="xs">
                {t("countstats.photos")}
              </Text>
              <Group gap="xs" align="baseline">
                <Title order={3} size="h4">
                  <Count value={countStats.num_photos} />
                </Title>
                <Text c="dimmed" size="xs">
                  / <Count value={countStats.num_albumdate} /> {t("days")}
                </Text>
              </Group>
            </div>
          </Group>
        </Card>
      </Grid.Col>

      {/* People & Faces combined. No count tooltips here: the card is already a HoverCard target. */}
      <Grid.Col span={{ base: 6, sm: 6, md: 3 }}>
        <HoverCard width={200} shadow="md" withinPortal withArrow>
          <HoverCard.Target>
            <Card withBorder p="xs">
              <Group justify="flex-start" gap="xs">
                <Users size={40} strokeWidth={1} />
                <div>
                  <Text c="dimmed" size="xs">
                    {t("people")}
                  </Text>
                  <Group gap="xs" align="baseline">
                    <Title order={3} size="h4">
                      <Count value={countStats.num_people} withTooltip={false} />
                    </Title>
                    <Text c="dimmed" size="xs">
                      / <Count value={countStats.num_faces} withTooltip={false} /> {t("faces")}
                    </Text>
                  </Group>
                </div>
              </Group>
            </Card>
          </HoverCard.Target>
          <HoverCard.Dropdown>
            <Stack gap="xs">
              <Group justify="space-between">
                <Text size="sm">
                  <Trans i18nKey="settings.inferred">Inferred</Trans>
                </Text>
                <Group gap="xs">
                  <FaceId size={16} />
                  <Text size="sm">{countStats.num_inferred_faces}</Text>
                </Group>
              </Group>
              <Group justify="space-between">
                <Text size="sm">
                  <Trans i18nKey="settings.labeled">Labeled</Trans>
                </Text>
                <Group gap="xs">
                  <Tag size={16} />
                  <Text size="sm">{countStats.num_labeled_faces}</Text>
                </Group>
              </Group>
              <Group justify="space-between">
                <Text size="sm">
                  <Trans i18nKey="settings.unknown">Unknown</Trans>
                </Text>
                <Group gap="xs">
                  <QuestionMark size={16} />
                  <Text size="sm">{countStats.num_unknown_faces}</Text>
                </Group>
              </Group>
            </Stack>
          </HoverCard.Dropdown>
        </HoverCard>
      </Grid.Col>

      {/* Events */}
      <Grid.Col span={{ base: 6, sm: 6, md: 3 }}>
        <Card withBorder p="xs">
          <Group justify="flex-start" gap="xs">
            <SettingsAutomation size={40} strokeWidth={1} />
            <div>
              <Text c="dimmed" size="xs">
                {t("events")}
              </Text>
              <Title order={3} size="h4">
                <Count value={countStats.num_albumauto} />
              </Title>
            </div>
          </Group>
        </Card>
      </Grid.Col>

      {/* Data Visualization link */}
      <Grid.Col span={{ base: 6, sm: 6, md: 3 }}>
        <style>
          {`
            @keyframes shimmer {
              0% { background-position: -200% center; }
              100% { background-position: 200% center; }
            }
            .dataviz-card {
              position: relative;
              overflow: hidden;
            }
            .dataviz-card::before {
              content: '';
              position: absolute;
              inset: 0;
              background: linear-gradient(
                110deg,
                transparent 20%,
                rgba(255, 193, 7, 0.15) 40%,
                rgba(255, 215, 0, 0.25) 50%,
                rgba(255, 193, 7, 0.15) 60%,
                transparent 80%
              );
              background-size: 200% 100%;
              opacity: 0;
              transition: opacity 0.3s ease;
              pointer-events: none;
            }
            .dataviz-card:hover::before {
              opacity: 1;
              animation: shimmer 1.5s infinite;
            }
          `}
        </style>
        <UnstyledButton component={Link} to="/statistics" style={{ display: "block", width: "100%" }}>
          <Card withBorder p="xs" className="dataviz-card" style={{ cursor: "pointer" }}>
            <Group justify="space-between" gap="xs" wrap="nowrap">
              <Group gap="xs">
                <ChartLine size={40} strokeWidth={1} color="var(--mantine-color-yellow-6)" />
                <div>
                  <Text c="var(--mantine-color-yellow-7)" size="xs" fw={600}>
                    {t("sidemenu.statistics")}
                  </Text>
                  <Text c="dimmed" size="xs">
                    {t("countstats.explorecharts", "Explore charts")}
                  </Text>
                </div>
              </Group>
              <ArrowRight size={20} color="var(--mantine-color-yellow-6)" />
            </Group>
          </Card>
        </UnstyledButton>
      </Grid.Col>
    </Grid>
  );
}
