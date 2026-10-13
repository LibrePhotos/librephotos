import type { EmailConfig, EmailConfigUpdate } from "@librephotos/api-client";
import {
  Alert,
  Anchor,
  Button,
  Card,
  Grid,
  Group,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import React, { useEffect, useEffectEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../api_client/api";
import {
  useGetEmailConfigQuery,
  useSendTestEmailMutation,
  useUpdateEmailConfigMutation,
} from "../../api_client/settings/hooks/useEmailConfig";
import { notification } from "../../service/notifications";
import { makeEmailSettingsSchema } from "./EmailSettings.schema";
import { ADMIN_SECTIONS } from "./sectionIds";
import { SectionLink, SettingsSection } from "./SettingsSection";

// "disabled" and "custom" are labelled with translated text at render time.
const PROVIDERS = [
  { value: "disabled", label: "" },
  { value: "custom", label: "" },
  { value: "sendgrid", label: "SendGrid" },
  { value: "mailgun", label: "Mailgun" },
  { value: "postmark", label: "Postmark" },
  { value: "brevo", label: "Brevo" },
  { value: "smtp2go", label: "SMTP2GO" },
  { value: "ses", label: "Amazon SES" },
];

// Providers whose SMTP host is not fixed and must be supplied by the admin.
const NEEDS_HOST = new Set(["custom", "ses"]);
// Providers that expose the full advanced SMTP fields (port / TLS / SSL).
const IS_CUSTOM = (provider: string) => provider === "custom";

// Label and control side by side from the sm breakpoint up, stacked on a phone.
const LABEL_SPAN = { base: 12, sm: 8 };
const CONTROL_SPAN = { base: 12, sm: 4 };

export function EmailSettings(): React.JSX.Element {
  const { t } = useTranslation();
  const { data: config, isLoading } = useGetEmailConfigQuery();
  const { mutate: save, isPending: isSaving } = useUpdateEmailConfigMutation({ reportsErrors: true });
  const { mutate: sendTest, isPending: isTesting } = useSendTestEmailMutation({ reportsErrors: true });

  const form = useForm({
    initialValues: {
      provider: "disabled",
      from_email: "",
      host: "",
      port: 587,
      use_tls: true,
      use_ssl: false,
      username: "",
      // A new credential; blank leaves the stored one.
      secret: "",
    },
    validate: schemaResolver(makeEmailSettingsSchema(t), { sync: true }),
  });
  const [hasSecret, setHasSecret] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Reads the form at load time; `form` is a new object every render and is not a trigger.
  const loadConfig = useEffectEvent((stored: EmailConfig) => {
    const values = {
      provider: stored.provider,
      from_email: stored.from_email,
      host: stored.host,
      port: stored.port,
      use_tls: stored.use_tls,
      use_ssl: stored.use_ssl,
      username: stored.username,
      secret: "",
    };
    form.setValues(values);
    // The stored configuration is what a change is measured against.
    form.resetDirty(values);
    setHasSecret(stored.has_secret);
  });
  useEffect(() => {
    if (!isLoading && config) {
      loadConfig(config);
    }
  }, [config, isLoading]);

  // Save only does something once a field differs from the stored configuration.
  const isDirty = !!config && form.isDirty();
  const { provider } = form.values;

  const providers = PROVIDERS.map(option => {
    if (option.value === "disabled") return { ...option, label: t("emailsettings.provider_disabled") };
    if (option.value === "custom") return { ...option, label: t("emailsettings.provider_custom") };
    return option;
  });

  const preset = config?.presets?.[provider];
  const presetHost = preset?.host;
  const helpUrl = preset?.help_url;

  // Same rules as reportUserSaveError (util/apiErrors.ts): a 401 is left to the auth handling, and
  // only the server's own message is shown, never the API client's internal English one.
  const reportSaveError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      return;
    }
    notification.error((error instanceof ApiError && error.serverMessage) || t("emailsettings.savefailed"));
  };

  const onSave = ({ secret, ...settings }: typeof form.values) => {
    setTestResult(null);
    const payload: EmailConfigUpdate = settings;
    // Only send the secret when the admin actually typed a new value, so a
    // blank field leaves the stored credential untouched.
    if (secret) {
      payload.secret = secret;
    }
    save(payload, {
      onSuccess: () => {
        form.setFieldValue("secret", "");
        setHasSecret(!!secret || hasSecret);
        notification.success(t("emailsettings.saved"));
      },
      onError: reportSaveError,
    });
  };

  const onClearSecret = () => {
    save(
      { clear_secret: true },
      {
        onSuccess: () => {
          setHasSecret(false);
          form.setFieldValue("secret", "");
        },
        onError: reportSaveError,
      }
    );
  };

  const onTest = () => {
    setTestResult(null);
    sendTest(undefined, {
      onSuccess: result => setTestResult({ ok: true, message: result.message }),
      // A refused send is a 502 carrying the mail server's own words (code
      // email_send_failed); a bad request says what is missing.
      onError: error =>
        setTestResult({
          ok: false,
          message: (error instanceof ApiError && error.serverMessage) || t("emailsettings.testfailed"),
        }),
    });
  };

  return (
    // Rendered inside SiteSettings, so it names its own anchor on the admin page.
    <SettingsSection id={ADMIN_SECTIONS.email}>
      <Card shadow="md" component="form" onSubmit={form.onSubmit(onSave)}>
        <Stack>
          <Title order={4} mb={4}>
            {t("emailsettings.header")}
            <SectionLink />
          </Title>
          <Text fz="sm" c="dimmed">
            {t("emailsettings.description")}
          </Text>

          <Grid justify="flex-end" align="center">
            <Grid.Col span={LABEL_SPAN}>
              <Text>{t("emailsettings.provider")}</Text>
            </Grid.Col>
            <Grid.Col span={CONTROL_SPAN}>
              <Select
                data={providers}
                value={provider}
                onChange={value => form.setFieldValue("provider", value || "disabled")}
                allowDeselect={false}
              />
            </Grid.Col>

            {provider !== "disabled" && (
              <>
                <Grid.Col span={LABEL_SPAN}>
                  <Text>{t("emailsettings.from_email")}</Text>
                </Grid.Col>
                <Grid.Col span={CONTROL_SPAN}>
                  <TextInput placeholder="LibrePhotos <no-reply@example.org>" {...form.getInputProps("from_email")} />
                </Grid.Col>

                {NEEDS_HOST.has(provider) && (
                  <>
                    <Grid.Col span={LABEL_SPAN}>
                      <Text>{t("emailsettings.host")}</Text>
                    </Grid.Col>
                    <Grid.Col span={CONTROL_SPAN}>
                      <TextInput
                        placeholder={provider === "ses" ? "email-smtp.us-east-1.amazonaws.com" : "smtp.example.org"}
                        {...form.getInputProps("host")}
                      />
                    </Grid.Col>
                  </>
                )}

                {!NEEDS_HOST.has(provider) && presetHost && (
                  <Grid.Col span={12}>
                    <Text fz="sm" c="dimmed">
                      {t("emailsettings.presethost", { host: presetHost })}{" "}
                      {helpUrl && (
                        <a href={helpUrl} target="_blank" rel="noreferrer">
                          {t("emailsettings.getkey")}
                        </a>
                      )}
                    </Text>
                  </Grid.Col>
                )}

                {IS_CUSTOM(provider) && (
                  <>
                    <Grid.Col span={LABEL_SPAN}>
                      <Text>{t("emailsettings.port")}</Text>
                    </Grid.Col>
                    <Grid.Col span={CONTROL_SPAN}>
                      <TextInput
                        type="number"
                        {...form.getInputProps("port")}
                        onChange={e => form.setFieldValue("port", Number(e.currentTarget.value) || 0)}
                      />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, xs: 6 }}>
                      <Switch
                        label={t("emailsettings.use_tls")}
                        {...form.getInputProps("use_tls", { type: "checkbox" })}
                      />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, xs: 6 }}>
                      <Switch
                        label={t("emailsettings.use_ssl")}
                        {...form.getInputProps("use_ssl", { type: "checkbox" })}
                      />
                    </Grid.Col>
                  </>
                )}

                <Grid.Col span={LABEL_SPAN}>
                  <Text>{t("emailsettings.username")}</Text>
                  {provider === "sendgrid" && (
                    <Text fz="xs" c="dimmed">
                      {t("emailsettings.sendgrid_username")}
                    </Text>
                  )}
                </Grid.Col>
                <Grid.Col span={CONTROL_SPAN}>
                  <TextInput {...form.getInputProps("username")} />
                </Grid.Col>

                <Grid.Col span={LABEL_SPAN}>
                  <Text>{t("emailsettings.secret")}</Text>
                </Grid.Col>
                <Grid.Col span={CONTROL_SPAN}>
                  <PasswordInput
                    placeholder={hasSecret ? t("emailsettings.secret_set") : ""}
                    {...form.getInputProps("secret")}
                  />
                </Grid.Col>
                {hasSecret && (
                  <Grid.Col span={12}>
                    <Anchor component="button" type="button" fz="xs" c="dimmed" onClick={onClearSecret}>
                      {t("emailsettings.clear_secret")}
                    </Anchor>
                  </Grid.Col>
                )}
              </>
            )}
          </Grid>

          <Group justify="flex-end">
            <Button variant="default" onClick={onTest} loading={isTesting} disabled={!config?.is_configured}>
              {t("emailsettings.sendtest")}
            </Button>
            <Button type="submit" loading={isSaving} disabled={!isDirty}>
              {t("save")}
            </Button>
          </Group>

          {testResult && (
            <Alert color={testResult.ok ? "green" : "red"} variant="light">
              {testResult.message}
            </Alert>
          )}
        </Stack>
      </Card>
    </SettingsSection>
  );
}
