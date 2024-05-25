import { Box, Stack, Text, ThemeIcon, UnstyledButton } from "@mantine/core";
import { createStyles } from "@mantine/emotion";
import React from "react";
import { push } from "redux-first-history";

import { useAppDispatch } from "../../store/store";

interface MainLinkProps {
  icon: React.ReactNode;
  color: string;
  label?: string;
  to?: string;
}

const useStyle = createStyles((theme, _, u) => ({
  container: {
    display: "block",
    width: "100%",
    padding: theme.spacing.xs,
    borderRadius: theme.radius.xs,
    [u.light]: {
      color: theme.black,
    },
    [u.dark]: {
      color: theme.colors.dark[0],
    },
    "&:hover": {
      [u.light]: {
        backgroundColor: theme.colors.gray[0],
      },
      [u.dark]: {
        backgroundColor: theme.colors.dark[6],
      },
    },
  },
  button: {
    width: 60,
    display: "block",
    padding: theme.spacing.xs,
    borderRadius: theme.radius.xs,
    [u.light]: {
      color: theme.black,
    },
    [u.dark]: {
      color: theme.colors.dark[0],
    },
    "&:hover": {
      [u.light]: {
        backgroundColor: theme.colors.gray[0],
      },
      [u.dark]: {
        backgroundColor: theme.colors.dark[6],
      },
    },
  },
}));

export function MainLink({ icon, color, label = "", to = "" }: Readonly<MainLinkProps>) {
  const dispatch = useAppDispatch();
  const { classes } = useStyle();

  return (
    <Box className={classes.container}>
      <UnstyledButton
        className={classes.button}
        onClick={() => {
          if (to) {
            dispatch(push(to));
          }
        }}
      >
        <Stack align="center" gap="xs">
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
}
