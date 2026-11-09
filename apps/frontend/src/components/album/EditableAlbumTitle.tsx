import { TextInput, Tooltip, UnstyledButton } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { IconPencil } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchUserAlbumsQuery, useRenameUserAlbumMutation } from "../../api_client/albums/hooks";
import classes from "./EditableAlbumTitle.module.css";
import { makeAlbumTitleSchema } from "./UserAlbumModals.schema";

type Props = Readonly<{ albumId: string; title: string }>;

function TitleField({ albumId, title, onDone }: Props & Readonly<{ onDone: () => void }>) {
  const { t } = useTranslation();
  // The other titles, for the duplicate check; usually cached from My Albums.
  const { data: albums } = useFetchUserAlbumsQuery();
  const rename = useRenameUserAlbumMutation();
  const existing = (albums ?? []).filter(album => String(album.id) !== albumId).map(album => album.title);
  const form = useForm({
    initialValues: { title },
    validate: schemaResolver(makeAlbumTitleSchema(t, existing), { sync: true }),
    validateInputOnChange: ["title"],
    transformValues: values => ({ title: values.title.trim() }),
  });

  const save = form.onSubmit(values => {
    if (values.title === title) {
      onDone();
      return;
    }
    rename.mutate({ id: albumId, title, newTitle: values.title }, { onSuccess: onDone });
  });

  return (
    <TextInput
      variant="unstyled"
      autoFocus
      aria-label={t("useralbum.renamealbum")}
      classNames={{ input: classes.input, error: classes.error }}
      {...form.getInputProps("title")}
      onFocus={event => event.currentTarget.select()}
      onKeyDown={event => {
        if (event.key === "Enter") save();
        if (event.key === "Escape") onDone();
      }}
      // Leaving the field keeps a valid new title and drops anything else, as Immich does
      onBlur={() => (form.isValid() ? save() : onDone())}
      disabled={rename.isPending}
    />
  );
}

/**
 * A user album's title for its owner: click it to rename it in place (Immich, Apple), Enter or
 * leaving the field saves, Escape cancels. The ⋯ menu's Rename dialog stays for the keyboard path
 * people know from My Albums.
 */
export function EditableAlbumTitle({ albumId, title }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  if (editing) return <TitleField albumId={albumId} title={title} onDone={() => setEditing(false)} />;
  return (
    <Tooltip label={t("useralbum.clicktorename")} position="bottom-start" openDelay={400}>
      <UnstyledButton className={classes.button} onClick={() => setEditing(true)}>
        {title}
        <IconPencil size={18} className={classes.pencil} aria-hidden />
      </UnstyledButton>
    </Tooltip>
  );
}
