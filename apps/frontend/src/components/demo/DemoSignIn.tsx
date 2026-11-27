import { Alert, Button, Stack, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import type { DemoSite } from "./useDemoSite";

type DemoSignInProps = {
  demo: DemoSite;
  loading: boolean;
  onSignIn: (demo: DemoSite) => void;
};

export function DemoSignIn({ demo, loading, onSignIn }: DemoSignInProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Alert title={t("demoSite.signInTitle")}>
      <Stack gap="sm">
        <Text size="sm">{t("demoSite.signInBody", { username: demo.username, password: demo.password })}</Text>
        <Button fullWidth loading={loading} onClick={() => onSignIn(demo)}>
          {t("demoSite.signInButton")}
        </Button>
      </Stack>
    </Alert>
  );
}
