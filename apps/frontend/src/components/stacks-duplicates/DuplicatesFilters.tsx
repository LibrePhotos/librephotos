import type { DuplicateListItem, DuplicateType, ReviewStatus } from "@librephotos/api-client";
import { Button, Checkbox, Group, Menu } from "@mantine/core";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { TOOLBAR_CONTROL_HEIGHT } from "../../uiConstants";
import { TabCount } from "../common/TabCount";
import { toolbarLook } from "../common/toolbarLook";

/** A status in the filter menu, with its number of groups dimmed after it ("All" has none). */
export type StatusOption = { value: string; label: string; count?: number };

// "All statuses" is no status, so it gets a sentinel value
export const ALL_STATUSES = "all";

export function DuplicatesFilters({
  duplicates,
  selectedOnPage,
  setSelectedDuplicateIds,
  statusFilter,
  onStatusChange,
  statusOptions,
  typeFilter,
  setTypeFilter,
  duplicateTypes,
}: {
  duplicates: DuplicateListItem[];
  selectedOnPage: number;
  setSelectedDuplicateIds: Dispatch<SetStateAction<Set<string>>>;
  statusFilter: ReviewStatus | undefined;
  onStatusChange: (value: string | null) => void;
  statusOptions: StatusOption[];
  typeFilter: DuplicateType | undefined;
  setTypeFilter: Dispatch<SetStateAction<DuplicateType | undefined>>;
  duplicateTypes: { value: DuplicateType | ""; label: string }[];
}) {
  const { t } = useTranslation();
  return (
    <Group>
      {/* Bulk selection checkbox */}
      {duplicates.length > 0 && (
        <Checkbox
          checked={selectedOnPage === duplicates.length}
          indeterminate={selectedOnPage > 0 && selectedOnPage < duplicates.length}
          onChange={e => {
            if (e.currentTarget.checked) {
              setSelectedDuplicateIds(new Set(duplicates.map(d => d.id)));
            } else {
              setSelectedDuplicateIds(new Set());
            }
          }}
          label={t("duplicates.selectAll")}
        />
      )}
      {/* Status filter: a toolbar menu like the type filter, the counts dimmed in its items */}
      <Menu shadow="md" width={220}>
        <Menu.Target>
          <Button {...toolbarLook()} h={TOOLBAR_CONTROL_HEIGHT} rightSection={<IconChevronDown size={14} />}>
            {statusOptions.find(option => option.value === (statusFilter ?? ALL_STATUSES))?.label}
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>{t("duplicates.statusfilter")}</Menu.Label>
          {statusOptions.map(option => (
            <Menu.Item
              key={option.value}
              onClick={() => onStatusChange(option.value)}
              rightSection={(statusFilter ?? ALL_STATUSES) === option.value ? <IconCheck size={14} /> : null}
            >
              <Group gap={6} wrap="nowrap" component="span">
                {option.label}
                {option.count === undefined ? null : <TabCount count={option.count} />}
              </Group>
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
      {/* Type filter */}
      <Menu shadow="md" width={200}>
        <Menu.Target>
          <Button
            {...toolbarLook(typeFilter !== undefined)}
            h={TOOLBAR_CONTROL_HEIGHT}
            rightSection={<IconChevronDown size={14} />}
          >
            {typeFilter ? t(`duplicates.types.${typeFilter}`) : t("duplicates.allTypes")}
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          {duplicateTypes.map(type => (
            <Menu.Item
              key={type.value}
              onClick={() => setTypeFilter(type.value || undefined)}
              rightSection={typeFilter === type.value || (!typeFilter && !type.value) ? <IconCheck size={14} /> : null}
            >
              {type.label}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}
