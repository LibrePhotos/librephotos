import { ActionIcon, Badge, Group, Stack, TagsInput, Text, Title, Tooltip } from "@mantine/core";
import { IconCheck, IconPencil, IconX } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchPhotoMetadataQuery, useUpdatePhotoMetadataMutation } from "../../api_client/photos/hooks";
import type { Photo as PhotoType } from "../../api_client/photos/types";

interface KeywordsSectionProps {
  photoDetail: PhotoType;
}

export function KeywordsSection({ photoDetail }: KeywordsSectionProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [draftKeywords, setDraftKeywords] = useState<string[]>([]);

  const { data: metadata } = useFetchPhotoMetadataQuery(photoDetail.id);
  const { mutate: updateMetadata, isPending: isSaving } = useUpdatePhotoMetadataMutation();

  const keywords = metadata?.keywords ?? [];

  const handleEditOpen = () => {
    setDraftKeywords(keywords);
    setEditing(true);
  };

  const handleCancel = () => {
    setEditing(false);
    setDraftKeywords([]);
  };

  const handleSave = () => {
    updateMetadata(
      { photoId: photoDetail.id, updates: { keywords: draftKeywords } },
      {
        onSuccess: () => {
          setEditing(false);
          setDraftKeywords([]);
        },
      }
    );
  };

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Title order={5}>{t("lightbox.sidebar.keywords", "Keywords")}</Title>
        {!editing ? (
          <Tooltip label={t("lightbox.sidebar.editKeywords", "Edit keywords")}>
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={handleEditOpen}>
              <IconPencil size={16} />
            </ActionIcon>
          </Tooltip>
        ) : (
          <Group gap="xs">
            <Tooltip label={t("lightbox.sidebar.cancel", "Cancel")}>
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={handleCancel} disabled={isSaving}>
                <IconX size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t("lightbox.sidebar.save", "Save")}>
              <ActionIcon variant="subtle" color="blue" size="sm" onClick={handleSave} loading={isSaving}>
                <IconCheck size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        )}
      </Group>

      {editing ? (
        <TagsInput
          value={draftKeywords}
          onChange={setDraftKeywords}
          placeholder={t("lightbox.sidebar.addKeyword", "Add keyword…")}
          splitChars={[",", " "]}
          clearable
        />
      ) : keywords.length > 0 ? (
        <Group gap="xs">
          {keywords.map(keyword => (
            <Badge
              key={keyword}
              color="violet"
              variant="light"
              style={{ cursor: "pointer" }}
              onClick={() => navigate({ to: `/search/${encodeURIComponent(keyword)}` })}
            >
              {keyword}
            </Badge>
          ))}
        </Group>
      ) : (
        <Text size="sm" c="dimmed">
          {t("lightbox.sidebar.noKeywords", "No keywords")}
        </Text>
      )}
    </Stack>
  );
}
