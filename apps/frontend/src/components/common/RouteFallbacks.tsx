import { Code } from "@mantine/core";
import { IconAlertTriangle, IconError404 } from "@tabler/icons-react";
import type { ErrorComponentProps } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "./EmptyState";

// Router-wide fallbacks (createRouter's defaultNotFoundComponent and
// defaultErrorComponent). They render inside the nearest layout that matched:
// a page error keeps the app's header and menu, an unknown URL fills the page.

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={<IconError404 size={40} />}
      title={t("routefallback.notfoundtitle")}
      description={t("routefallback.notfounddescription")}
      actionLabel={t("publicalbum.goHome")}
      actionLink="/"
    />
  );
}

export function RouteErrorPage({ error }: ErrorComponentProps) {
  const { t } = useTranslation();
  return (
    <>
      <EmptyState
        icon={<IconAlertTriangle size={40} />}
        title={t("routefallback.errortitle")}
        description={t("routefallback.errordescription")}
        actionLabel={t("routefallback.reload")}
        // A full reload also recovers a tab that still points at the code
        // chunks of the version before an upgrade.
        onAction={() => window.location.reload()}
        secondaryActionLabel={t("publicalbum.goHome")}
        secondaryActionLink="/"
      />
      {import.meta.env.DEV && error instanceof Error && (
        <Code block mx="auto" maw={600}>
          {error.message}
        </Code>
      )}
    </>
  );
}
