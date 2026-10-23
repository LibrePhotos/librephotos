import type { RightsDefaultCountsResponse } from "@librephotos/api-client";
import { Button, Group, Modal, Radio, Skeleton, Stack, Text } from "@mantine/core";
import { useForm } from "@mantine/form";
import React from "react";
import { useTranslation } from "react-i18next";
import { useApplyRightsDefaultMutation, useRightsDefaultCountsQuery } from "../../api_client/photos/hooks";
import { DisabledReason } from "../common/DisabledReason";
import { ErrorState } from "../common/ErrorState";
import { useListFailure } from "../common/useListFailure";
import { WriteBackHint } from "../lightbox/WriteBackHint";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
}>;

/** Which photos "Apply" changes: only what is missing, or every photo. */
type Reach = "missing" | "all";

/**
 * "Apply to my photos" of the default rights (#425): how many photos it reaches, and whether photos
 * that have rights of their own keep them. It asks first, so published photos are never relicensed
 * by a change of the default alone.
 */
export function ApplyRightsDefaultModal({ opened, onClose }: Props) {
  const { t } = useTranslation();
  const counts = useRightsDefaultCountsQuery(opened);
  const failure = useListFailure(counts);
  return (
    <Modal opened={opened} onClose={onClose} title={t("rights.default.applyTitle")} centered>
      {failure && <ErrorState failure={failure} compact />}
      {counts.data && <ApplyForm counts={counts.data} onClose={onClose} />}
      {!counts.data && !failure && (
        <Stack aria-busy>
          <Skeleton h={20} />
          <Skeleton h={60} />
        </Stack>
      )}
    </Modal>
  );
}

function ApplyForm({ counts, onClose }: Readonly<{ counts: RightsDefaultCountsResponse; onClose: () => void }>) {
  const { t } = useTranslation();
  const initialValues: { reach: Reach } = { reach: "missing" };
  const form = useForm({ initialValues });
  const { mutate, isPending } = useApplyRightsDefaultMutation();
  const { reach } = form.getValues();
  const count = reach === "all" ? counts.total : counts.missing;

  const apply = form.onSubmit(values => {
    if (count === 0) return;
    mutate(values.reach === "all" ? "none" : "any", { onSuccess: onClose });
  });

  return (
    <form onSubmit={apply}>
      <Stack>
        <Radio.Group value={reach} onChange={value => form.setFieldValue("reach", value === "all" ? "all" : "missing")}>
          <Stack gap="sm">
            <Radio
              value="missing"
              label={t("rights.default.reachMissing", { count: counts.missing })}
              description={t("rights.default.reachMissingHint")}
            />
            <Radio
              value="all"
              label={t("rights.default.reachAll", { count: counts.total })}
              description={t("rights.default.reachAllHint")}
            />
          </Stack>
        </Radio.Group>
        <Text size="sm" c="dimmed">
          {t("rights.default.applyNote")}
        </Text>
        <WriteBackHint field="rights" />
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>
            {t("cancel")}
          </Button>
          <DisabledReason reason={count === 0 && t("rights.default.nothingToApply")}>
            <Button type="submit" loading={isPending}>
              {t("rights.default.applyConfirm", { count })}
            </Button>
          </DisabledReason>
        </Group>
      </Stack>
    </form>
  );
}
