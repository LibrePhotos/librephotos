import type { SiteSettings, SiteSsoProvider } from "@librephotos/api-client";
import { Anchor, Code, Divider, Group, Stack, Switch, Text, TextInput } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { IconAlertTriangle as AlertTriangle, IconInfoCircle as InfoCircle } from "@tabler/icons-react";
import React, { useEffect, useEffectEvent } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useGetSettingsQuery } from "../../api_client/settings/hooks";
import { DOCUMENTATION_LINK } from "../../uiConstants";
import { ADMIN_SECTIONS } from "./sectionIds";
import classes from "./SsoSettings.module.css";
import { makeSsoLabelSchema, MAX_SSO_LABEL } from "./SsoSettings.schema";
import { useSaveSiteSettings } from "./useSaveSiteSettings";

/** The counter under the label shows from here on. */
const SSO_LABEL_COUNTER_FROM = 48;

const SSO_GUIDE_URL = `${DOCUMENTATION_LINK}/docs/user-guide/settings/single-sign-on`;
const PROVIDER_ADMIN_URL = "/api/django-admin/socialaccount/socialapp/";

/** A link in a translated sentence: `<Trans>` fills in the words between its tags. */
function ExternalLink({ href, children }: { href: string; children?: React.ReactNode }) {
  return (
    <Anchor href={href} fz="xs" target="_blank" rel="noreferrer">
      {children}
    </Anchor>
  );
}

/**
 * A problem that keeps single sign-on from working: an icon and words, not colour alone. Spans
 * only, because a switch description is a paragraph.
 */
function SsoWarning({ tone, children }: { tone: "warning" | "error"; children: React.ReactNode }) {
  return (
    <Group component="span" gap={4} wrap="nowrap" align="flex-start" className={classes[tone]}>
      <AlertTriangle size={14} aria-hidden className={classes.icon} />
      <Text component="span" fz="xs" inherit>
        {children}
      </Text>
    </Group>
  );
}

/** What turning SSO on does and, while it is on, what keeps it from working. */
function EnabledDescription({ settings }: { settings: SiteSettings }) {
  const { t } = useTranslation();
  const on = settings.oidc_enabled === true;
  const noProviderHere = on && settings.sso_providers?.every(provider => !provider.on_this_site);
  return (
    <Stack gap={2} component="span">
      <span>{t("sitesettings.sso_enabled_description")}</span>
      {noProviderHere && (
        <SsoWarning tone="warning">
          <Trans
            i18nKey="sitesettings.sso_no_provider_on_site"
            components={{ admin: <ExternalLink href={PROVIDER_ADMIN_URL} /> }}
          />
        </SsoWarning>
      )}
      {on && settings.public_url_configured === false && (
        <SsoWarning tone="error">
          <Trans i18nKey="sitesettings.sso_public_url_missing" components={{ code: <Code fz="xs" /> }} />
        </SsoWarning>
      )}
    </Stack>
  );
}

/** What sign-ups over SSO do and, without email, that they stay closed. */
function SignupDescription({ emailConfigured }: { emailConfigured: boolean }) {
  const { t } = useTranslation();
  return (
    <Stack gap={2} component="span">
      <span>{t("sitesettings.sso_allow_signup_description")}</span>
      {!emailConfigured && (
        <SsoWarning tone="warning">
          {t("sitesettings.sso_signup_needs_email")}{" "}
          <Anchor href={`#${ADMIN_SECTIONS.email}`} fz="xs">
            {t("sitesettings.sso_set_up_email")}
          </Anchor>
        </SsoWarning>
      )}
    </Stack>
  );
}

/** The providers from the Django admin, read-only, with where to change them. */
function ProvidersNote({ providers }: { providers: SiteSsoProvider[] }) {
  const { t } = useTranslation();
  const links = {
    admin: <ExternalLink href={PROVIDER_ADMIN_URL} />,
    guide: <ExternalLink href={SSO_GUIDE_URL} />,
  };
  const names = providers
    .map(provider =>
      provider.on_this_site ? provider.name : t("sitesettings.sso_provider_not_attached", { name: provider.name })
    )
    .join(", ");
  return (
    <Group gap={4} wrap="nowrap" align="flex-start">
      <InfoCircle size={14} aria-hidden className={classes.icon} />
      <Text fz="xs" c="dimmed">
        {providers.length > 0 ? (
          <Trans i18nKey="sitesettings.sso_providers" values={{ names }} components={links} />
        ) : (
          <Trans i18nKey="sitesettings.sso_no_providers" components={links} />
        )}
      </Text>
    </Group>
  );
}

/** The button label: saved on blur and Enter, trimmed, refused past the server's limit. */
function ButtonLabelInput({ stored }: { stored: string }) {
  const { t } = useTranslation();
  const { dataUpdatedAt } = useGetSettingsQuery();
  const save = useSaveSiteSettings();
  const form = useForm({
    initialValues: { label: stored },
    validate: schemaResolver(makeSsoLabelSchema(t), { sync: true }),
    validateInputOnChange: true,
  });
  // A refused save, or the same value fetched again, puts back what the server has. `form` is a
  // new object every render and is not a trigger.
  const showStored = useEffectEvent((value: string) => form.setValues({ label: value }));
  useEffect(() => showStored(stored), [stored, dataUpdatedAt]);

  const length = form.values.label.trim().length;
  const saveLabel = () => {
    if (form.validate().hasErrors) return;
    const trimmed = form.values.label.trim();
    form.setValues({ label: trimmed });
    if (trimmed !== stored) save({ oidc_button_label: trimmed });
  };

  return (
    <TextInput
      label={t("sitesettings.sso_label")}
      description={t("sitesettings.sso_label_description")}
      placeholder={t("login.sso.button")}
      rightSection={length >= SSO_LABEL_COUNTER_FROM ? `${length} / ${MAX_SSO_LABEL}` : undefined}
      rightSectionWidth={64}
      classNames={{ section: classes.counter }}
      {...form.getInputProps("label")}
      onBlur={saveLabel}
      onKeyDown={event => {
        if (event.key === "Enter") saveLabel();
      }}
    />
  );
}

/**
 * The single sign-on group of the Site Settings card (#2725): the OIDC_* switches the guide sends
 * admins to. The providers live in the Django admin and the public URL in the environment, so
 * those are only reported, as warnings under the switch they affect. Hidden for an older backend
 * that does not send the switches.
 */
export function SsoSettingsGroup() {
  const { t } = useTranslation();
  const { data: settings } = useGetSettingsQuery();
  const save = useSaveSiteSettings();
  if (!settings || settings.oidc_enabled === undefined) {
    return null;
  }
  const enabled = settings.oidc_enabled;
  return (
    <Stack gap="sm">
      <Divider label={t("sitesettings.sso_header")} labelPosition="left" classNames={{ label: classes.header }} />
      <Switch
        label={t("sitesettings.sso_enabled")}
        description={<EnabledDescription settings={settings} />}
        checked={enabled}
        onChange={() => save({ oidc_enabled: !enabled })}
      />
      <div className={classes.indent}>
        <ButtonLabelInput stored={settings.oidc_button_label ?? ""} />
      </div>
      <Switch
        label={t("sitesettings.sso_allow_signup")}
        description={<SignupDescription emailConfigured={settings.email_configured ?? false} />}
        checked={settings.oidc_allow_signup ?? false}
        onChange={() => save({ oidc_allow_signup: !settings.oidc_allow_signup })}
      />
      {settings.sso_providers && (
        <div className={classes.indent}>
          <ProvidersNote providers={settings.sso_providers} />
        </div>
      )}
    </Stack>
  );
}
