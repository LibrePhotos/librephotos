import { Button, Checkbox, Group, Menu, SegmentedControl, Select } from "@mantine/core";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import type { Duplicate, DuplicateType, ReviewStatus } from "../../api_client/duplicates/types";

// Select options cannot be "", so "all statuses" gets a sentinel value
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
  duplicates: Duplicate[];
  selectedOnPage: number;
  setSelectedDuplicateIds: Dispatch<SetStateAction<Set<string>>>;
  statusFilter: ReviewStatus | undefined;
  onStatusChange: (value: string | null) => void;
  statusOptions: { value: string; label: string }[];
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
      {/* Status filter: the segmented control cannot wrap, so phones get a select */}
      <SegmentedControl
        visibleFrom="sm"
        size="sm"
        value={statusFilter ?? ALL_STATUSES}
        onChange={onStatusChange}
        data={statusOptions}
      />
      <Select
        hiddenFrom="sm"
        size="sm"
        w={200}
        aria-label={t("duplicates.statusfilter")}
        value={statusFilter ?? ALL_STATUSES}
        onChange={onStatusChange}
        data={statusOptions}
        allowDeselect={false}
      />
      {/* Type filter */}
      <Menu shadow="md" width={200}>
        <Menu.Target>
          <Button variant="light" size="sm" rightSection={<IconChevronDown size={14} />}>
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
