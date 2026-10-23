import { Button, Group, Stack, Textarea } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import React from "react";
import { useTranslation } from "react-i18next";
import { makeCommentSchema, MAX_COMMENT_LENGTH } from "./CommentForm.schema";

type Props = Readonly<{
  initialText?: string;
  submitLabel: string;
  loading: boolean;
  onSubmit: (text: string, done: () => void) => void;
  onCancel?: () => void;
}>;

/**
 * Writes a comment (#262), new or edited: Enter sends, Shift+Enter starts a new line. The text is
 * plain: whatever is typed is sent and shown as it is.
 */
export function CommentForm({ initialText = "", submitLabel, loading, onSubmit, onCancel }: Props) {
  const { t } = useTranslation();
  const form = useForm({
    initialValues: { text: initialText },
    validate: schemaResolver(makeCommentSchema(t), { sync: true }),
  });
  const submit = form.onSubmit(({ text }) => onSubmit(text.trim(), () => form.reset()));

  return (
    <form onSubmit={submit}>
      <Stack gap={6}>
        <Textarea
          aria-label={t("collab.writeComment")}
          placeholder={t("collab.writeComment")}
          description={t("collab.writeCommentHint")}
          minRows={2}
          maxLength={MAX_COMMENT_LENGTH}
          {...form.getInputProps("text")}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <Group justify="flex-end" gap="xs">
          {onCancel && (
            <Button size="xs" variant="default" onClick={onCancel}>
              {t("collab.cancel")}
            </Button>
          )}
          <Button size="xs" type="submit" loading={loading}>
            {submitLabel}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
