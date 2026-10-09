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
import { showNotification } from "@mantine/notifications";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../api_client/api";
import type { EmailConfigUpdate } from "../../api_client/settings/hooks/useEmailConfig";
import {
  useGetEmailConfigQuery,
  useSendTestEmailMutation,
  useUpdateEmailConfigMutation,
} from "../../api_client/settings/hooks/useEmailConfig";

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

export function EmailSettings(): JSX.Element {
  const { t } = useTranslation();
  const { data: config, isLoading } = useGetEmailConfigQuery();
  const { mutate: save, isPending: isSaving } = useUpdateEmailConfigMutation();
  const { mutate: sendTest, isPending: isTesting } = useSendTestEmailMutation();

  const [provider, setProvider] = useState("disabled");
  const [fromEmail, setFromEmail] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(587);
  const [useTls, setUseTls] = useState(true);
  const [useSsl, setUseSsl] = useState(false);
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [hasSecret, setHasSecret] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!isLoading && config) {
      setProvider(config.provider);
      setFromEmail(config.from_email);
      setHost(config.host);
      setPort(config.port);
      setUseTls(config.use_tls);
      setUseSsl(config.use_ssl);
      setUsername(config.username);
      setHasSecret(config.has_secret);
      setSecret("");
    }
  }, [config, isLoading]);

  // Save only does something once a field differs from the stored configuration.
  const isDirty =
    !!config &&
    (provider !== config.provider ||
      fromEmail !== config.from_email ||
      host !== config.host ||
      port !== config.port ||
      useTls !== config.use_tls ||
      useSsl !== config.use_ssl ||
      username !== config.username ||
      secret !== "");

  const providers = PROVIDERS.map(option => {
    if (option.value === "disabled") return { ...option, label: t("emailsettings.provider_disabled") };
    if (option.value === "custom") return { ...option, label: t("emailsettings.provider_custom") };
    return option;
  });

  const preset = config?.presets?.[provider];
  const presetHost = preset?.host;
  const helpUrl = preset?.help_url;

  // Same rules as reportUserSaveError (util/apiErrors.ts): a 401 is left to the auth handling, and
  // only the server's own message is shown, never FetchClient's internal English one.
  const reportSaveError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      return;
    }
    showNotification({
      message: (error instanceof ApiError && error.serverMessage) || t("emailsettings.savefailed"),
      color: "red",
    });
  };

  const onSave = () => {
    setTestResult(null);
    const payload: EmailConfigUpdate = {
      provider,
      from_email: fromEmail,
      host,
      port,
      use_tls: useTls,
      use_ssl: useSsl,
      username,
    };
    // Only send the secret when the admin actually typed a new value, so a
    // blank field leaves the stored credential untouched.
    if (secret) {
      payload.secret = secret;
    }
    save(payload, {
      onSuccess: () => {
        setSecret("");
        setHasSecret(!!secret || hasSecret);
        showNotification({ message: t("emailsettings.saved"), color: "teal" });
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
          setSecret("");
        },
        onError: reportSaveError,
      }
    );
  };

  const onTest = () => {
    setTestResult(null);
    sendTest(undefined, {
      onSuccess: result => setTestResult({ ok: result.status, message: result.message }),
      onError: () => setTestResult({ ok: false, message: t("emailsettings.testfailed", "Test email failed to send.") }),
    });
  };

  return (
    <Card shadow="md">
      <Stack>
        <Title order={4} mb={4}>
          {t("emailsettings.header", "Email (SMTP)")}
        </Title>
        <Text fz="sm" c="dimmed">
          {t(
            "emailsettings.description",
            "Configure outgoing email so the server can send account and notification emails. The credential is encrypted before it is stored."
          )}
        </Text>

        <Grid justify="flex-end" align="center">
          <Grid.Col span={LABEL_SPAN}>
            <Text>{t("emailsettings.provider", "Provider")}</Text>
          </Grid.Col>
          <Grid.Col span={CONTROL_SPAN}>
            <Select
              data={providers}
              value={provider}
              onChange={value => setProvider(value || "disabled")}
              allowDeselect={false}
            />
          </Grid.Col>

          {provider !== "disabled" && (
            <>
              <Grid.Col span={LABEL_SPAN}>
                <Text>{t("emailsettings.from_email", "From address")}</Text>
              </Grid.Col>
              <Grid.Col span={CONTROL_SPAN}>
                <TextInput
                  placeholder="LibrePhotos <no-reply@example.org>"
                  value={fromEmail}
                  onChange={e => setFromEmail(e.currentTarget.value)}
                />
              </Grid.Col>

              {NEEDS_HOST.has(provider) && (
                <>
                  <Grid.Col span={LABEL_SPAN}>
                    <Text>{t("emailsettings.host", "SMTP host")}</Text>
                  </Grid.Col>
                  <Grid.Col span={CONTROL_SPAN}>
                    <TextInput
                      placeholder={provider === "ses" ? "email-smtp.us-east-1.amazonaws.com" : "smtp.example.org"}
                      value={host}
                      onChange={e => setHost(e.currentTarget.value)}
                    />
                  </Grid.Col>
                </>
              )}

              {!NEEDS_HOST.has(provider) && presetHost && (
                <Grid.Col span={12}>
                  <Text fz="sm" c="dimmed">
                    {t("emailsettings.presethost", "Sends via {{host}} over TLS.", { host: presetHost })}{" "}
                    {helpUrl && (
                      <a href={helpUrl} target="_blank" rel="noreferrer">
                        {t("emailsettings.getkey", "Where do I get the key?")}
                      </a>
                    )}
                  </Text>
                </Grid.Col>
              )}

              {IS_CUSTOM(provider) && (
                <>
                  <Grid.Col span={LABEL_SPAN}>
                    <Text>{t("emailsettings.port", "Port")}</Text>
                  </Grid.Col>
                  <Grid.Col span={CONTROL_SPAN}>
                    <TextInput type="number" value={port} onChange={e => setPort(Number(e.currentTarget.value) || 0)} />
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, xs: 6 }}>
                    <Switch
                      label={t("emailsettings.use_tls", "Use STARTTLS")}
                      checked={useTls}
                      onChange={e => setUseTls(e.currentTarget.checked)}
                    />
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, xs: 6 }}>
                    <Switch
                      label={t("emailsettings.use_ssl", "Use implicit SSL")}
                      checked={useSsl}
                      onChange={e => setUseSsl(e.currentTarget.checked)}
                    />
                  </Grid.Col>
                </>
              )}

              <Grid.Col span={LABEL_SPAN}>
                <Text>{t("emailsettings.username", "Username")}</Text>
                {provider === "sendgrid" && (
                  <Text fz="xs" c="dimmed">
                    {t("emailsettings.sendgrid_username", 'Leave blank; SendGrid uses the literal username "apikey".')}
                  </Text>
                )}
              </Grid.Col>
              <Grid.Col span={CONTROL_SPAN}>
                <TextInput value={username} onChange={e => setUsername(e.currentTarget.value)} />
              </Grid.Col>

              <Grid.Col span={LABEL_SPAN}>
                <Text>{t("emailsettings.secret", "Password / API key")}</Text>
              </Grid.Col>
              <Grid.Col span={CONTROL_SPAN}>
                <PasswordInput
                  placeholder={hasSecret ? t("emailsettings.secret_set", "•••••• (unchanged)") : ""}
                  value={secret}
                  onChange={e => setSecret(e.currentTarget.value)}
                />
              </Grid.Col>
              {hasSecret && (
                <Grid.Col span={12}>
                  <Anchor component="button" type="button" fz="xs" c="dimmed" onClick={onClearSecret}>
                    {t("emailsettings.clear_secret", "Remove the stored credential")}
                  </Anchor>
                </Grid.Col>
              )}
            </>
          )}
        </Grid>

        <Group justify="flex-end">
          <Button variant="default" onClick={onTest} loading={isTesting} disabled={!config?.is_configured}>
            {t("emailsettings.sendtest", "Send test email")}
          </Button>
          <Button onClick={onSave} loading={isSaving} disabled={!isDirty}>
            {t("save", "Save")}
          </Button>
        </Group>

        {testResult && (
          <Alert color={testResult.ok ? "green" : "red"} variant="light">
            {testResult.message}
          </Alert>
        )}
      </Stack>
    </Card>
  );
}
