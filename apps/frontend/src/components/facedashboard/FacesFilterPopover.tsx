import { FaceAnalysisMethod, type PersonGroup } from "@librephotos/api-client";
import {
  ActionIcon,
  Badge,
  Button,
  Indicator,
  NumberInput,
  Popover,
  SegmentedControl,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconFilter as Filter, IconSettings as Settings } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE, TOOLBAR_ACTION_SIZE, TOOLBAR_CONTROL_HEIGHT } from "../../uiConstants";
import { ManagePersonGroupsModal } from "../album/ManagePersonGroupsModal";
import { toolbarLook } from "../common/toolbarLook";
import { FACES_SEARCH_DEFAULTS, type FacesTab } from "./facesTab";
import classes from "./FacesToolbar.module.css";

type Props = Readonly<{
  tab: FacesTab;
  method: FaceAnalysisMethod;
  minConfidence: number;
  onMethod: (method: FaceAnalysisMethod) => void;
  onMinConfidence: (fraction: number) => void;
  /** The user's groups of people, and the one the people are narrowed to (#1126). */
  personGroups: readonly PersonGroup[];
  groupId: number | undefined;
  onGroup: (group: number | undefined) => void;
  /** A phone: an icon with the number of filters set. */
  compact: boolean;
}>;

const ALL_GROUPS = "all";

function SectionLabel({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Text size="xs" fw={700} c="dimmed" tt="uppercase">
      {children}
    </Text>
  );
}

/**
 * The faces dashboard's Filter: on the Inferred and Unknown tabs the analysis method and the
 * confidence a suggestion needs, on the tabs of people their group (#1126). One button instead of
 * three controls in the toolbar; a number on it counts the filters that are not the default.
 */
export function FacesFilterPopover({
  tab,
  method,
  minConfidence,
  onMethod,
  onMinConfidence,
  personGroups,
  groupId,
  onGroup,
  compact,
}: Props) {
  const { t } = useTranslation();
  const [manageOpened, manage] = useDisclosure(false);
  const suggestions = tab === "inferred" || tab === "unknown";
  // The Unknown tab holds no people, so it has no group to narrow to
  const groups = tab !== "unknown";
  const active = [
    suggestions && method !== FACES_SEARCH_DEFAULTS.method,
    suggestions && minConfidence !== FACES_SEARCH_DEFAULTS.minConfidence,
    groups && groupId !== undefined,
  ].filter(Boolean).length;
  const label = t("facesdashboard.filter");
  const activeLabel = active > 0 ? t("timelinefilter.activecount", { count: active }) : undefined;

  return (
    <>
      {/* The dropdown is portaled: trap focus in it and hand it back to the button on close */}
      <Popover width={300} position="bottom-end" shadow="md" withinPortal trapFocus returnFocus>
        {compact ? (
          <Indicator label={active} size={16} disabled={active === 0}>
            <Popover.Target>
              <ActionIcon
                {...toolbarLook(active > 0)}
                size={TOOLBAR_ACTION_SIZE}
                aria-label={activeLabel ? `${label}, ${activeLabel}` : label}
              >
                <Filter size={ICON_SIZE.toolbar} />
              </ActionIcon>
            </Popover.Target>
          </Indicator>
        ) : (
          <Popover.Target>
            <Button
              {...toolbarLook(active > 0)}
              h={TOOLBAR_CONTROL_HEIGHT}
              leftSection={<Filter size={ICON_SIZE.toolbar} />}
              rightSection={
                active > 0 ? (
                  <Badge size="sm" circle aria-label={activeLabel}>
                    {active}
                  </Badge>
                ) : null
              }
            >
              {label}
            </Button>
          </Popover.Target>
        )}
        <Popover.Dropdown aria-label={label} className={classes.dropdown}>
          <Stack gap="sm">
            {suggestions && (
              <>
                <SectionLabel>{t("facesdashboard.show")}</SectionLabel>
                <SegmentedControl
                  fullWidth
                  aria-label={t("facesdashboard.show")}
                  value={method}
                  onChange={value => {
                    const next = FaceAnalysisMethod.safeParse(value);
                    if (next.success) onMethod(next.data);
                  }}
                  data={[
                    { value: FaceAnalysisMethod.enum.clustering, label: t("facesdashboard.clusters") },
                    { value: FaceAnalysisMethod.enum.classification, label: t("facesdashboard.classifications") },
                  ]}
                />
                <NumberInput
                  label={t("facesdashboard.minconfidence")}
                  value={minConfidence * 100}
                  onChange={value => {
                    if (typeof value === "number") onMinConfidence(value / 100);
                  }}
                  min={0}
                  max={100}
                  step={5}
                  decimalScale={0}
                  suffix={t("facesdashboard.confidentsuffix")}
                />
              </>
            )}
            {groups && (
              <>
                <Select
                  label={t("persongroups.title")}
                  value={groupId === undefined ? ALL_GROUPS : String(groupId)}
                  allowDeselect={false}
                  // Inside the popover, so a click on an option is not a click outside it
                  comboboxProps={{ withinPortal: false }}
                  onChange={value => onGroup(value === null || value === ALL_GROUPS ? undefined : Number(value))}
                  data={[
                    { value: ALL_GROUPS, label: t("persongroups.all") },
                    ...personGroups.map(group => ({ value: String(group.id), label: group.name })),
                  ]}
                />
                <Button
                  variant="subtle"
                  color="gray"
                  size="compact-sm"
                  leftSection={<Settings size={ICON_SIZE.menu} />}
                  onClick={manage.open}
                  className={classes.manage}
                >
                  {t("persongroups.manage")}
                </Button>
              </>
            )}
          </Stack>
        </Popover.Dropdown>
      </Popover>
      <ManagePersonGroupsModal opened={manageOpened} onClose={manage.close} />
    </>
  );
}
