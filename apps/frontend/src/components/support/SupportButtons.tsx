import { Button, Group, Stack } from "@mantine/core";
import { IconBrandGithub as Github, IconHeart as Heart } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { GITHUB_REPO_LINK, PAYPAL_DONATE_LINK, SUPPORT_LINK } from "../../uiConstants";

type SupportButtonsProps = Readonly<{
  /** Called when one of the links opens (in a new tab). */
  onAction: () => void;
  /** Stacked full width, for Rewind's narrow card. */
  stacked?: boolean;
}>;

/** Star on GitHub, sponsor on GitHub, or donate through PayPal. */
export function SupportButtons({ onAction, stacked = false }: SupportButtonsProps) {
  const { t } = useTranslation();
  const link = { component: "a", target: "_blank", rel: "noreferrer", onClick: onAction, fullWidth: stacked } as const;
  const buttons = (
    <>
      <Button {...link} href={SUPPORT_LINK} color="pink.9" leftSection={<Heart size={16} />}>
        {t("support.sponsor")}
      </Button>
      {/* Rewind's end slide is white in either colour scheme: an outline, not the dark default. */}
      <Button
        {...link}
        href={PAYPAL_DONATE_LINK}
        variant={stacked ? "outline" : "default"}
        color={stacked ? "dark" : undefined}
      >
        {t("support.paypal")}
      </Button>
      <Button {...link} href={GITHUB_REPO_LINK} color="dark" leftSection={<Github size={16} />}>
        {t("support.star")}
      </Button>
    </>
  );
  return stacked ? <Stack gap={8}>{buttons}</Stack> : <Group gap="xs">{buttons}</Group>;
}
