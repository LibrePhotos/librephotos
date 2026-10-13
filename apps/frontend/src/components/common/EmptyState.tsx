import { Button, Center, Progress, Stack, Text, ThemeIcon, Title, type MantineColor } from "@mantine/core";
import { IconPhoto } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";

export type EmptyStateProps = Readonly<{
  icon?: React.ReactNode;
  /** The icon's colour; gray by default, blue while a scan shows its progress. */
  iconColor?: MantineColor;
  title: string;
  description: string;
  actionLabel?: string;
  actionLink?: string;
  secondaryActionLabel?: string;
  secondaryActionLink?: string;
  onAction?: () => void;
  /** Shows a spinner on the primary button while its action runs (ErrorState's Retry). */
  actionLoading?: boolean;
  onSecondaryAction?: () => void;
  progress?: {
    current: number;
    target: number;
  };
}>;

export function EmptyState({
  icon,
  iconColor,
  title,
  description,
  actionLabel,
  actionLink,
  secondaryActionLabel,
  secondaryActionLink,
  onAction,
  actionLoading = false,
  onSecondaryAction,
  progress,
}: EmptyStateProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const handlePrimaryClick = () => {
    if (onAction) {
      onAction();
    } else if (actionLink) {
      navigate({ to: actionLink });
    }
  };

  const handleSecondaryClick = () => {
    if (onSecondaryAction) {
      onSecondaryAction();
    } else if (secondaryActionLink) {
      navigate({ to: secondaryActionLink });
    }
  };

  const progressPercent = progress && progress.target > 0 ? (progress.current / progress.target) * 100 : undefined;

  return (
    <Center py={80}>
      <Stack align="center" gap="md" maw={400} w="100%">
        <ThemeIcon size={80} radius="xl" variant="light" color={iconColor ?? (progress ? "blue" : "gray")}>
          {icon || <IconPhoto size={40} />}
        </ThemeIcon>
        <Title order={3} ta="center">
          {title}
        </Title>
        {progress && (
          <Stack w="100%" gap="xs" px="xl">
            <Progress
              value={progressPercent ?? 0}
              size="md"
              radius="xl"
              animated={progressPercent === undefined || progressPercent < 100}
              color="blue"
            />
            <Text c="dimmed" ta="center" size="sm">
              {/* One string, so translations can order the numbers and words themselves */}
              {t("emptystate.scanning.progress", { current: progress.current, count: progress.target })}
            </Text>
          </Stack>
        )}
        <Text c="dimmed" ta="center" size="sm">
          {description}
        </Text>
        {(actionLabel || secondaryActionLabel) && (
          <Stack gap="xs" mt="md">
            {actionLabel && (
              <Button variant="filled" onClick={handlePrimaryClick} loading={actionLoading}>
                {actionLabel}
              </Button>
            )}
            {secondaryActionLabel && (
              <Button variant="subtle" onClick={handleSecondaryClick}>
                {secondaryActionLabel}
              </Button>
            )}
          </Stack>
        )}
      </Stack>
    </Center>
  );
}
