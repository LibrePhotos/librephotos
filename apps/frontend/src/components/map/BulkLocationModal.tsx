import type { LocationSummaryResponse } from "@librephotos/api-client";
import { Button, Group, Modal, Skeleton, Stack } from "@mantine/core";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocatedNearbyQuery } from "../../api_client/photos/hooks/useLocatedNearbyQuery";
import { useLocationSummaryQuery } from "../../api_client/photos/hooks/useLocationSummaryQuery";
import { useSetPhotosLocationMutation } from "../../api_client/photos/hooks/useSetPhotosLocationMutation";
import type { PhotoSelection } from "../../api_client/photos/photoSelection";
import { DisabledReason } from "../common/DisabledReason";
import { ErrorState } from "../common/ErrorState";
import { useListFailure } from "../common/useListFailure";
import { WriteBackHint } from "../lightbox/WriteBackHint";
import { BulkLocationChoice, savePlan, type LocationTargets } from "./BulkLocationChoice";
import { LocationPickerBody } from "./LocationPickerBody";
import { hasPosition, NearbyLocatedStrip } from "./NearbyLocatedStrip";
import { nearbyWindow, type TakenSpan } from "./nearbyTime";
import { useLocationPicker, useStartNearNearest } from "./useLocationPicker";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  /** The selected photos, as the bulk photo actions name them. */
  selection: PhotoSelection;
  /** The location was saved: the selection is done with. */
  onDone: () => void;
}>;

/**
 * "Set location…" for the selected photos (#2279): the location picker with how many of them
 * already have a location, whether to replace those, and the photos taken around the same time to
 * copy a location from. One request sets them all; the server looks the place up once.
 */
export function BulkLocationModal({ opened, onClose, selection, onDone }: Props) {
  const { t } = useTranslation();
  const summary = useLocationSummaryQuery(opened ? selection : null);
  const failure = useListFailure(summary);
  const title = summary.data
    ? t("locationpicker.bulk_title", { count: summary.data.count })
    : t("locationpicker.bulk_title_pending");
  return (
    <Modal opened={opened} onClose={onClose} title={title} centered>
      {failure && <ErrorState failure={failure} compact />}
      {summary.data && (
        <BulkLocationPicker selection={selection} summary={summary.data} onClose={onClose} onDone={onDone} />
      )}
      {!summary.data && !failure && (
        <Stack aria-busy>
          <Skeleton h={20} />
          <Skeleton h={350} />
        </Stack>
      )}
    </Modal>
  );
}

function takenSpan(summary: LocationSummaryResponse): TakenSpan | null {
  const { first_taken: first, last_taken: last } = summary;
  return first && last ? { first, last } : null;
}

function BulkLocationPicker({
  selection,
  summary,
  onClose,
  onDone,
}: Readonly<{ selection: PhotoSelection; summary: LocationSummaryResponse; onClose: () => void; onDone: () => void }>) {
  const { t } = useTranslation();
  const [targets, setTargets] = useState<LocationTargets>("missing");
  const picker = useLocationPicker(null);
  const span = takenSpan(summary);
  const nearby = useLocatedNearbyQuery(nearbyWindow(span));
  useStartNearNearest(picker, nearby.data?.find(hasPosition));
  const { mutate, isPending } = useSetPhotosLocationMutation();
  const plan = savePlan(summary, targets);

  const save = () => {
    if (!picker.position) return;
    const [lat, lon] = picker.position;
    mutate(
      { selection, lat, lon, overwrite: plan.overwrite },
      {
        onSuccess: () => {
          onClose();
          onDone();
        },
      }
    );
  };

  return (
    <Stack>
      <BulkLocationChoice summary={summary} targets={targets} onChange={setTargets} />
      {/* An optional shortcut: when the photos cannot be read (the failure is toasted), it is left out. */}
      {span && !nearby.isError && (
        <NearbyLocatedStrip photos={nearby.data} span={span} position={picker.position} onPick={picker.pickPhoto} />
      )}
      <LocationPickerBody picker={picker} initialPosition={null} />
      <WriteBackHint field="location" />
      <Group justify="flex-end" gap="xs">
        <Button variant="default" onClick={onClose}>
          {t("cancel")}
        </Button>
        <DisabledReason reason={!picker.position && t("locationpicker.pick_first")}>
          <Button onClick={save} loading={isPending}>
            {t("locationpicker.bulk_save", { count: plan.count })}
          </Button>
        </DisabledReason>
      </Group>
    </Stack>
  );
}
