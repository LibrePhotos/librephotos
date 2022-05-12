import { Box, Stack, Text, ThemeIcon, UnstyledButton } from "@mantine/core";
import { push } from "connected-react-router";
import React from "react";

import { useAppDispatch } from "../../store/store";

interface MainLinkProps {
  icon: React.ReactNode;
  color: string;
  label: string;
  to?: string;
}

export const MainLink = ({ icon, color, label, to = "" }: MainLinkProps) => {
  const dispatch = useAppDispatch();
  return (
    <Box
      sx={theme => ({
        display: "block",
        width: "100%",
        padding: theme.spacing.xs,
        borderRadius: theme.radius.xs,
        color: theme.colorScheme === "dark" ? theme.colors.dark[0] : theme.black,

        "&:hover": {
          backgroundColor: theme.colorScheme === "dark" ? theme.colors.dark[6] : theme.colors.gray[0],
        },
      })}
    >
      <UnstyledButton
        style={{ width: 60 }}
        sx={theme => ({
          display: "block",

          padding: theme.spacing.xs,
          borderRadius: theme.radius.xs,
          color: theme.colorScheme === "dark" ? theme.colors.dark[0] : theme.black,

          "&:hover": {
            backgroundColor: theme.colorScheme === "dark" ? theme.colors.dark[6] : theme.colors.gray[0],
          },
        })}
        onClick={() => {
          if (to) {
            dispatch(push(to));
          }
        }}
      >
        <Stack align="center" spacing="xs">
          <ThemeIcon size="lg" variant="light" color={color}>
            {icon}
          </ThemeIcon>
          <Text style={{ wordWrap: "break-word", maxWidth: 55 }} size="xs">
            {label}
          </Text>
        </Stack>
      </UnstyledButton>
    </Box>
  );
};
