import { Button, Checkbox, Divider, Group, Modal, ScrollArea, Stack, Text } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useCreatePersonGroupMutation,
  useFetchPersonGroupsQuery,
  useSetPersonGroupsMutation,
} from "../../api_client/albums/hooks";
import { ICON_SIZE } from "../../uiConstants";
import { ErrorState } from "../common/ErrorState";
import { PageLoader } from "../common/PageLoader";
import { useListFailure } from "../common/useListFailure";
import { PersonGroupNameForm } from "./PersonGroupNameForm";

type GroupedPerson = Readonly<{ id: string; name: string; group_ids: readonly number[] }>;

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  /** The person as the dialog opens (a People tile, or the person page). */
  person: GroupedPerson;
}>;

/** Toggle `id` in `ids`, keeping the order the ids came in. */
function toggled(ids: readonly number[], id: number): number[] {
  return ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id];
}

function Checklist({ person, onClose }: Omit<Props, "opened">) {
  const { t } = useTranslation();
  const groupsQuery = useFetchPersonGroupsQuery();
  const listFailure = useListFailure(groupsQuery);
  const setGroups = useSetPersonGroupsMutation();
  const createGroup = useCreatePersonGroupMutation({ reportsErrors: true });
  // The dialog's own copy: a tick shows at once and the next tick builds on it, while the people
  // list refetches behind it. The body unmounts on close, so every opening starts from the person.
  const [checked, setChecked] = useState<number[]>(() => [...person.group_ids]);
  const groups = groupsQuery.data ?? [];

  const save = (next: number[]) => {
    const before = checked;
    setChecked(next);
    // Only undoes the ticks: the QueryClient's toast reports the failure.
    setGroups.mutate({ personId: person.id, groupIds: next }, { onError: () => setChecked(before) });
  };

  const createAndAdd = async (name: string) => {
    const created = await createGroup.mutateAsync(name);
    save([...checked, created.id]);
  };

  if (listFailure) return <ErrorState failure={listFailure} compact />;
  if (groupsQuery.isLoading) return <PageLoader />;

  return (
    <Stack gap="sm">
      {groups.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t("persongroups.none")}
        </Text>
      ) : (
        <ScrollArea.Autosize mah={320} type="auto">
          <Stack gap="xs" role="group" aria-label={t("persongroups.title")}>
            {groups.map(group => (
              <Checkbox
                key={group.id}
                label={group.name}
                checked={checked.includes(group.id)}
                onChange={() => save(toggled(checked, group.id))}
              />
            ))}
          </Stack>
        </ScrollArea.Autosize>
      )}
      <Divider />
      <PersonGroupNameForm
        existingNames={groups.map(group => group.name)}
        label={t("persongroups.new")}
        submitLabel={t("persongroups.add")}
        submitIcon={<IconPlus size={ICON_SIZE.inline} />}
        pending={createGroup.isPending}
        onSubmit={createAndAdd}
        autoFocus={groups.length === 0}
      />
      <Text size="xs" c="dimmed">
        {t("persongroups.savedastyoutick")}
      </Text>
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          {t("persongroups.done")}
        </Button>
      </Group>
    </Stack>
  );
}

/** Which of the user's groups one person is in (#1126): a checklist saved on every tick. */
export function PersonGroupsModal({ opened, onClose, person }: Props) {
  const { t } = useTranslation();
  return (
    <Modal size="sm" opened={opened} onClose={onClose} title={t("persongroups.dialogtitle", { name: person.name })}>
      <Checklist person={person} onClose={onClose} />
    </Modal>
  );
}
