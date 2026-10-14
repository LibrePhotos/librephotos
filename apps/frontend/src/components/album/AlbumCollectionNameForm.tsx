import { ActionIcon, Button, Group, TextInput } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { IconX } from "@tabler/icons-react";
import React from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../api_client/apiError";
import { ICON_SIZE } from "../../uiConstants";
import { makeAlbumCollectionNameSchema } from "./AlbumCollectionNameForm.schema";

type Props = Readonly<{
  /** The names already taken; the collection's own name is not among them on a rename. */
  existingNames: readonly string[];
  initialName?: string;
  /** The field's accessible name; it shows as the placeholder. */
  label: string;
  submitLabel: string;
  submitIcon?: ReactNode;
  pending: boolean;
  /** Saves the trimmed name; a rejection shows the server's reason under the field. */
  onSubmit: (name: string) => Promise<unknown>;
  /** A rename offers to back out; creating does not. */
  onCancel?: () => void;
  autoFocus?: boolean;
}>;

/** One line to name an album collection (#1009): creating one, or renaming it in place. */
export function AlbumCollectionNameForm({
  existingNames,
  initialName = "",
  label,
  submitLabel,
  submitIcon,
  pending,
  onSubmit,
  onCancel,
  autoFocus = false,
}: Props) {
  const { t } = useTranslation();
  const form = useForm({
    initialValues: { name: initialName },
    validate: schemaResolver(makeAlbumCollectionNameSchema(t, existingNames), { sync: true }),
    transformValues: ({ name }) => ({ name: name.trim() }),
  });

  return (
    <form
      onSubmit={form.onSubmit(({ name }) => {
        void onSubmit(name).then(
          () => form.reset(),
          (error: unknown) =>
            form.setFieldError("name", (error instanceof ApiError && error.serverMessage) || t("toasts.requestfailed"))
        );
      })}
    >
      <Group gap="xs" align="flex-start" wrap="nowrap">
        <TextInput
          aria-label={label}
          placeholder={label}
          size="sm"
          flex={1}
          data-autofocus={autoFocus || undefined}
          {...form.getInputProps("name")}
        />
        <Button type="submit" variant="default" size="sm" leftSection={submitIcon} loading={pending}>
          {submitLabel}
        </Button>
        {onCancel && (
          <ActionIcon variant="subtle" color="gray" size="lg" aria-label={t("cancel")} onClick={onCancel}>
            <IconX size={ICON_SIZE.inline} />
          </ActionIcon>
        )}
      </Group>
    </form>
  );
}
