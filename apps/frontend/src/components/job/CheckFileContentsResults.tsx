import { Alert, Badge, Card, Group, List, Stack, Table, Text, Title } from "@mantine/core";
import { IconCircleCheck } from "@tabler/icons-react";
import type { ParseKeys } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";
import type { CheckFileContentsResult, Verdict } from "./checkFileContentsResult";
import classes from "./CheckFileContentsResults.module.css";

type Count = "unchanged" | Verdict | "missing" | "unreadable";

/** The summary rows, in the order a reader wants them: what changed and how, then what failed. */
const ROWS: readonly Readonly<{ count: Count; label: ParseKeys; description: ParseKeys }>[] = [
  { count: "unchanged", label: "checkfilecontents.unchanged", description: "checkfilecontents.unchangeddescription" },
  {
    count: "new_picture",
    label: "checkfilecontents.newpicture",
    description: "checkfilecontents.newpicturedescription",
  },
  {
    count: "same_picture",
    label: "checkfilecontents.samepicture",
    description: "checkfilecontents.samepicturedescription",
  },
  {
    count: "similar_picture",
    label: "checkfilecontents.similarpicture",
    description: "checkfilecontents.similarpicturedescription",
  },
  {
    count: "uncomparable",
    label: "checkfilecontents.uncomparable",
    description: "checkfilecontents.uncomparabledescription",
  },
  { count: "missing", label: "checkfilecontents.missing", description: "checkfilecontents.missingdescription" },
  {
    count: "unreadable",
    label: "checkfilecontents.unreadable",
    description: "checkfilecontents.unreadabledescription",
  },
];

const VERDICT_LABEL: Record<Verdict, ParseKeys> = {
  new_picture: "checkfilecontents.newpicture",
  same_picture: "checkfilecontents.samepicture",
  similar_picture: "checkfilecontents.similarpicture",
  uncomparable: "checkfilecontents.uncomparable",
};

const VERDICT_COLOR: Record<Verdict, string> = {
  new_picture: "blue",
  same_picture: "gray",
  similar_picture: "teal",
  uncomparable: "yellow",
};

type Props = Readonly<{ result: CheckFileContentsResult }>;

function SummaryTable({ result }: Props) {
  const { t } = useTranslation();
  return (
    <Table>
      <Table.Tbody>
        {ROWS.filter(row => row.count === "unchanged" || result[row.count] > 0).map(row => (
          <Table.Tr key={row.count}>
            {/* The description under its label, so the table fits a phone */}
            <Table.Th scope="row" fw={400}>
              <Text fw={600}>{t(row.label)}</Text>
              <Text size="sm" c="dimmed">
                {t(row.description)}
              </Text>
            </Table.Th>
            <Table.Td ta="right" valign="top" fw={600}>
              {result[row.count].toLocaleString()}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

/** One row per user when the run covered several; wide, so it scrolls sideways on a phone. */
function UsersTable({ result }: Props) {
  const { t } = useTranslation();
  const columns: readonly Count[] = ["new_picture", "same_picture", "similar_picture", "uncomparable", "unreadable"];
  return (
    <Stack gap="xs">
      <Title order={5}>{t("checkfilecontents.byuser")}</Title>
      <Table.ScrollContainer minWidth={560}>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("checkfilecontents.user")}</Table.Th>
              <Table.Th ta="right">{t("checkfilecontents.filesread")}</Table.Th>
              {columns.map(column => (
                <Table.Th key={column} ta="right">
                  {t(ROWS.find(row => row.count === column)?.label ?? "checkfilecontents.unchanged")}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {result.users.map(user => (
              <Table.Tr key={user.user_id}>
                <Table.Td>{user.username}</Table.Td>
                <Table.Td ta="right">{user.checked.toLocaleString()}</Table.Td>
                {columns.map(column => (
                  <Table.Td key={column} ta="right">
                    {user[column].toLocaleString()}
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}

/** The changed files with what became of each (at most 100, capped by the backend). */
function ChangedFiles({ result }: Props) {
  const { t } = useTranslation();
  return (
    <Stack gap="xs">
      <Title order={5}>{t("checkfilecontents.changedfiles")}</Title>
      <List spacing="sm" listStyleType="none">
        {result.changed.map(change => (
          <List.Item key={change.path}>
            {/* The verdict under the path: a long server path would squeeze it to nothing beside it */}
            <Stack gap={2}>
              <Text size="sm" ff="monospace" className={classes.path}>
                {change.path}
              </Text>
              <Group gap="xs">
                <Badge color={VERDICT_COLOR[change.verdict]} variant="light" size="sm">
                  {t(VERDICT_LABEL[change.verdict])}
                </Badge>
                {change.named_faces_removed > 0 && (
                  <Text size="xs" c="orange">
                    {t("checkfilecontents.namedfacesremoved", { count: change.named_faces_removed })}
                  </Text>
                )}
              </Group>
            </Stack>
          </List.Item>
        ))}
      </List>
    </Stack>
  );
}

/**
 * The Results card of a finished Check file contents job (#2040): how many files were read, what
 * became of the changed ones (in plain words, per user when the run covered several) and which
 * files changed. The failed items stay in the job page's own partial-failure card.
 */
export function CheckFileContentsResults({ result }: Props) {
  const { t } = useTranslation();
  const changed = result.new_picture + result.same_picture + result.similar_picture + result.uncomparable;
  return (
    <Card shadow="md">
      <Stack>
        <div>
          <Title order={4}>{t("checkfilecontents.results")}</Title>
          <Text size="sm" c="dimmed">
            {t("checkfilecontents.read", { count: result.checked })}
          </Text>
        </div>
        {changed === 0 && result.unreadable === 0 ? (
          <Alert
            color="green"
            title={t("checkfilecontents.nothingchanged")}
            icon={<IconCircleCheck size={ICON_SIZE.inline} />}
          >
            {t("checkfilecontents.nothingchangeddescription")}
          </Alert>
        ) : (
          <SummaryTable result={result} />
        )}
        {result.rescans > 0 && <Text size="sm">{t("checkfilecontents.rescans", { count: result.rescans })}</Text>}
        {result.users.length > 1 && <UsersTable result={result} />}
        {result.changed.length > 0 && <ChangedFiles result={result} />}
      </Stack>
    </Card>
  );
}
