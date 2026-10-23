import { USER_PLACE_ICONS, type UserPlace, type UserPlaceCircle } from "@librephotos/api-client";
import {
  Button,
  Checkbox,
  CloseButton,
  Group,
  Paper,
  SegmentedControl,
  Slider,
  Stack,
  Text,
  TextInput,
  VisuallyHidden,
} from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { useDebouncedValue } from "@mantine/hooks";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSaveUserPlaceMutation, useUserPlacePreviewQuery } from "../../api_client/albums/hooks";
import { ApiError } from "../../api_client/apiError";
import { DisabledReason } from "../common/DisabledReason";
import { makePlaceEditorSchema } from "./PlaceEditor.schema";
import classes from "./PlaceEditorPanel.module.css";
import { RADIUS_LIMITS } from "./placeGeometry";
import { PLACE_ICON_LABELS, PLACE_ICONS } from "./placeIcons";
import { PlacePreview } from "./PlacePreview";
import type { PlaceEditorState } from "./usePlaceEditor";

type Props = Readonly<{
  editor: PlaceEditorState;
  /** All of the user's places: their names are taken. */
  places: readonly UserPlace[];
  onRadiusChange: (radiusM: number) => void;
  onClose: () => void;
  /** Over the map on a wide screen, or under it on a phone. */
  floating: boolean;
}>;

// How long the radius rests before the count is asked for again.
const PREVIEW_DEBOUNCE_MS = 300;

/**
 * The form of the place being drawn (#1365): its name, size, icon and whether event titles may
 * use it, with a live count of the photos taken inside. The centre comes from a click on the map.
 */
export function PlaceEditorPanel({ editor, places, onRadiusChange, onClose, floating }: Props) {
  const { t } = useTranslation();
  const existingNames = useMemo(
    () => places.filter(place => place.id !== editor.id).map(place => place.name),
    [places, editor.id]
  );
  const form = useForm({
    initialValues: { name: editor.name, icon: editor.icon, useInTitles: editor.useInTitles },
    validate: schemaResolver(makePlaceEditorSchema(t, existingNames), { sync: true }),
    transformValues: values => ({ ...values, name: values.name.trim() }),
  });
  const { center, radiusM } = editor;
  const circle: UserPlaceCircle | null = center && { lat: center.lat, lon: center.lon, radiusM, exclude: editor.id };
  const [debouncedCircle] = useDebouncedValue(circle, PREVIEW_DEBOUNCE_MS);
  const preview = useUserPlacePreviewQuery(debouncedCircle);
  const save = useSaveUserPlaceMutation({ reportsErrors: true });

  const submit = form.onSubmit(values => {
    if (!center) return;
    save.mutate(
      {
        id: editor.id,
        fields: {
          name: values.name,
          icon: values.icon,
          use_in_titles: values.useInTitles,
          center_lat: center.lat,
          center_lon: center.lon,
          radius_m: radiusM,
        },
      },
      {
        onSuccess: onClose,
        onError: error =>
          form.setFieldError("name", (error instanceof ApiError && error.serverMessage) || t("toasts.requestfailed")),
      }
    );
  });

  const title = editor.id === undefined ? t("yourplaces.editor.newTitle") : t("yourplaces.editor.editTitle");
  return (
    <Paper
      component="form"
      onSubmit={submit}
      className={floating ? classes.floating : undefined}
      withBorder
      shadow={floating ? "md" : undefined}
      p="md"
      aria-label={title}
    >
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <Text fw={600}>{title}</Text>
          <CloseButton aria-label={t("cancel")} onClick={onClose} />
        </Group>
        {!center && (
          <Text size="sm" c="dimmed">
            {t("yourplaces.editor.hint")}
          </Text>
        )}
        <TextInput label={t("yourplaces.editor.name")} withAsterisk data-autofocus {...form.getInputProps("name")} />
        <div>
          <Group justify="space-between">
            <Text size="sm" fw={500} id="place-radius-label">
              {t("yourplaces.editor.radius")}
            </Text>
            <Text size="sm" c="dimmed">
              {t("yourplaces.metres", { count: radiusM })}
            </Text>
          </Group>
          <Slider
            min={RADIUS_LIMITS.min}
            max={RADIUS_LIMITS.max}
            step={5}
            value={radiusM}
            onChange={onRadiusChange}
            label={value => t("yourplaces.metres", { count: value })}
            thumbProps={{ "aria-labelledby": "place-radius-label" }}
          />
        </div>
        <div>
          <Text size="sm" fw={500} mb={4} id="place-icon-label">
            {t("yourplaces.editor.icon")}
          </Text>
          <SegmentedControl
            aria-labelledby="place-icon-label"
            fullWidth
            {...form.getInputProps("icon")}
            data={USER_PLACE_ICONS.map(icon => {
              const Icon = PLACE_ICONS[icon];
              return {
                value: icon,
                label: (
                  <>
                    <Icon size={18} aria-hidden />
                    <VisuallyHidden>{t(PLACE_ICON_LABELS[icon])}</VisuallyHidden>
                  </>
                ),
              };
            })}
          />
        </div>
        {center && <PlacePreview query={preview} />}
        <Checkbox
          label={t("yourplaces.editor.useInTitles")}
          description={t("yourplaces.editor.useInTitlesHint")}
          {...form.getInputProps("useInTitles", { type: "checkbox" })}
        />
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>
            {t("cancel")}
          </Button>
          <DisabledReason reason={!center && t("yourplaces.editor.centreRequired")}>
            <Button type="submit" loading={save.isPending}>
              {t("yourplaces.editor.save")}
            </Button>
          </DisabledReason>
        </Group>
      </Stack>
    </Paper>
  );
}
