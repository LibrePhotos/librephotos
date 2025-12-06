import { Button, Center, Progress, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconPhoto } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React from "react";

type EmptyStateProps = Readonly<{
  icon?: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  actionLink?: string;
  secondaryActionLabel?: string;
  secondaryActionLink?: string;
  onAction?: () => void;
  onSecondaryAction?: () => void;
  progress?: {
    current: number;
    target: number;
  };
}>;

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  actionLink,
  secondaryActionLabel,
  secondaryActionLink,
  onAction,
  onSecondaryAction,
  progress,
}: EmptyStateProps) {
  const navigate = useNavigate();

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

  const progressPercent = progress && progress.target > 0 
    ? (progress.current / progress.target) * 100 
    : undefined;

  return (
    <Center py={80}>
      <Stack align="center" gap="md" maw={400} w="100%">
        <ThemeIcon size={80} radius="xl" variant="light" color={progress ? "blue" : "gray"}>
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
              {progress.current} / {progress.target} items
            </Text>
          </Stack>
        )}
        <Text c="dimmed" ta="center" size="sm">
          {description}
        </Text>
        {(actionLabel || secondaryActionLabel) && (
          <Stack gap="xs" mt="md">
            {actionLabel && (
              <Button variant="filled" onClick={handlePrimaryClick}>
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

