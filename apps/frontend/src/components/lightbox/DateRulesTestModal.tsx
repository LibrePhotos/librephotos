import type { DateRuleOutcome, DateRulesTest } from "@librephotos/api-client";
import { Alert, Anchor, Badge, Group, Modal, Stack, Table, Text } from "@mantine/core";
import { IconCircleCheck as CircleCheck } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../api_client/api";
import { useDateRulesTestQuery } from "../../api_client/settings/hooks/useDateRulesTestQuery";
import { formatPhotoDateTime, formatUtcOffset } from "../../util/dateUtils";
import { ErrorState } from "../common/ErrorState";
import { PageLoader } from "../common/PageLoader";
import { useListFailure } from "../common/useListFailure";
import { modalTitleStyles } from "../modals/modalTitleStyles";
import { SETTINGS_SECTIONS } from "../settings/sectionIds";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  /** One of the user's own photos (`Photo.id`). */
  photoId: string;
}>;

type Translate = TFunction<"translation", undefined>;

function ruleName(outcome: DateRuleOutcome, index: number, t: Translate): string {
  return outcome.name || t("daterules.test_unnamed", { position: index + 1 });
}

/** What a rule read, as a date and time with its offset where the rule knows it. */
function readDate(outcome: DateRuleOutcome): string {
  if (!outcome.local_time) return "";
  const date = formatPhotoDateTime(outcome.local_time);
  return outcome.utc_offset === null ? date : `${date} (${formatUtcOffset(outcome.utc_offset)})`;
}

function outcomeText(outcome: DateRuleOutcome, t: Translate): string {
  switch (outcome.outcome) {
    case "applies":
      return readDate(outcome);
    case "not_applicable":
      return t("daterules.test_not_applicable");
    case "error":
      return t("daterules.test_error", { error: outcome.error ?? "" });
  }
}

/** The one-line answer above the table: the date set by hand, the rule a scan uses, or none. */
function Summary({ result }: Readonly<{ result: DateRulesTest }>) {
  const { t } = useTranslation();
  if (result.date_set_by_user) {
    return <Alert color="blue">{t("daterules.test_set_by_hand")}</Alert>;
  }
  const winner = result.winner === null ? undefined : result.outcomes[result.winner];
  if (!winner || result.winner === null) {
    return <Text>{t("daterules.test_no_winner")}</Text>;
  }
  // The date the photo has now, when the winning rule would give it another one.
  const shown = result.exif_timestamp ? formatPhotoDateTime(result.exif_timestamp) : null;
  const read = winner.local_time ? formatPhotoDateTime(winner.local_time) : null;
  return (
    <Stack gap={4}>
      <Text>{t("daterules.test_winner", { name: ruleName(winner, result.winner, t), date: readDate(winner) })}</Text>
      {shown && shown !== read && (
        <Text size="sm" c="dimmed">
          {t("daterules.test_differs", { date: shown })}
        </Text>
      )}
    </Stack>
  );
}

/** The outcomes with their place: the rules run in order, and an id may be missing or repeated. */
function rowsOf(result: DateRulesTest) {
  return result.outcomes.map((outcome, position) => ({ outcome, position }));
}

function OutcomeTable({ result }: Readonly<{ result: DateRulesTest }>) {
  const { t } = useTranslation();
  return (
    <Table>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{t("daterules.test_rule")}</Table.Th>
          <Table.Th w="40%">{t("daterules.test_outcome")}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rowsOf(result).map(({ outcome, position }) => {
          const used = !result.date_set_by_user && position === result.winner;
          return (
            <Table.Tr key={position}>
              <Table.Td fw={used ? 700 : undefined}>
                <Group gap={6}>
                  <span>{ruleName(outcome, position, t)}</span>
                  {used && (
                    <Badge size="xs" color="teal" variant="light" leftSection={<CircleCheck size={12} aria-hidden />}>
                      {t("daterules.test_used")}
                    </Badge>
                  )}
                </Group>
              </Table.Td>
              <Table.Td c={outcome.outcome === "applies" ? undefined : "dimmed"}>{outcomeText(outcome, t)}</Table.Td>
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}

function TestResult({ photoId }: Readonly<{ photoId: string }>) {
  const { t } = useTranslation();
  const query = useDateRulesTestQuery(photoId);
  const failure = useListFailure(query);
  if (query.error instanceof ApiError && query.error.status === 404) {
    return <Alert color="orange">{query.error.serverMessage ?? t("daterules.test_failed")}</Alert>;
  }
  if (failure) return <ErrorState failure={failure} compact />;
  if (!query.data) return <PageLoader />;
  return (
    <Stack gap="md">
      <Summary result={query.data} />
      <OutcomeTable result={query.data} />
    </Stack>
  );
}

/**
 * "Why this date?" (#2272): what each of the owner's saved date rules reads from this photo, in
 * order, and which one a scan takes the date from. Nothing changes; the rules are edited on the
 * settings page.
 */
export function DateRulesTestModal({ opened, onClose, photoId }: Props) {
  const { t } = useTranslation();
  return (
    <Modal styles={modalTitleStyles} opened={opened} onClose={onClose} size="lg" title={t("daterules.why")}>
      {opened && (
        <Stack gap="md">
          <TestResult photoId={photoId} />
          <Anchor size="sm" renderRoot={props => <Link to="/settings" hash={SETTINGS_SECTIONS.datetime} {...props} />}>
            {t("daterules.test_edit_rules")}
          </Anchor>
        </Stack>
      )}
    </Modal>
  );
}
