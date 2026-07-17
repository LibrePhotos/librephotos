import {
  Alert,
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
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useGetEmailConfigQuery,
  useSendTestEmailMutation,
  useUpdateEmailConfigMutation,
} from "../../api_client/settings/hooks/useEmailConfig";

const PROVIDERS = [
  { value: "disabled", label: "Disabled" },
  { value: "custom", label: "Custom SMTP server" },
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

  const presetHost = config?.presets?.[provider]?.host as string | undefined;
  const helpUrl = config?.presets?.[provider]?.help_url as string | undefined;

  const onSave = () => {
    setTestResult(null);
    const payload: Record<string, unknown> = {
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
      },
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
    <Card shadow="md" mb={10}>
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
          <Grid.Col span={8}>
            <Text>{t("emailsettings.provider", "Provider")}</Text>
          </Grid.Col>
          <Grid.Col span={4}>
            <Select
              data={PROVIDERS}
              value={provider}
              onChange={value => setProvider(value || "disabled")}
              allowDeselect={false}
            />
          </Grid.Col>

          {provider !== "disabled" && (
            <>
              <Grid.Col span={8}>
                <Text>{t("emailsettings.from_email", "From address")}</Text>
              </Grid.Col>
              <Grid.Col span={4}>
                <TextInput
                  placeholder="LibrePhotos <no-reply@example.org>"
                  value={fromEmail}
                  onChange={e => setFromEmail(e.currentTarget.value)}
                />
              </Grid.Col>

              {NEEDS_HOST.has(provider) && (
                <>
                  <Grid.Col span={8}>
                    <Text>{t("emailsettings.host", "SMTP host")}</Text>
                  </Grid.Col>
                  <Grid.Col span={4}>
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
                  <Grid.Col span={8}>
                    <Text>{t("emailsettings.port", "Port")}</Text>
                  </Grid.Col>
                  <Grid.Col span={4}>
                    <TextInput type="number" value={port} onChange={e => setPort(Number(e.currentTarget.value) || 0)} />
                  </Grid.Col>
                  <Grid.Col span={6}>
                    <Switch
                      label={t("emailsettings.use_tls", "Use STARTTLS")}
                      checked={useTls}
                      onChange={e => setUseTls(e.currentTarget.checked)}
                    />
                  </Grid.Col>
                  <Grid.Col span={6}>
                    <Switch
                      label={t("emailsettings.use_ssl", "Use implicit SSL")}
                      checked={useSsl}
                      onChange={e => setUseSsl(e.currentTarget.checked)}
                    />
                  </Grid.Col>
                </>
              )}

              <Grid.Col span={8}>
                <Text>{t("emailsettings.username", "Username")}</Text>
                {provider === "sendgrid" && (
                  <Text fz="xs" c="dimmed">
                    {t("emailsettings.sendgrid_username", 'Leave blank; SendGrid uses the literal username "apikey".')}
                  </Text>
                )}
              </Grid.Col>
              <Grid.Col span={4}>
                <TextInput value={username} onChange={e => setUsername(e.currentTarget.value)} />
              </Grid.Col>

              <Grid.Col span={8}>
                <Text>{t("emailsettings.secret", "Password / API key")}</Text>
              </Grid.Col>
              <Grid.Col span={4}>
                <PasswordInput
                  placeholder={hasSecret ? t("emailsettings.secret_set", "•••••• (unchanged)") : ""}
                  value={secret}
                  onChange={e => setSecret(e.currentTarget.value)}
                />
              </Grid.Col>
              {hasSecret && (
                <Grid.Col span={12}>
                  <Text fz="xs" c="dimmed" style={{ cursor: "pointer" }} onClick={onClearSecret}>
                    {t("emailsettings.clear_secret", "Remove the stored credential")}
                  </Text>
                </Grid.Col>
              )}
            </>
          )}
        </Grid>

        <Group>
          <Button onClick={onSave} loading={isSaving}>
            {t("save", "Save")}
          </Button>
          <Button variant="default" onClick={onTest} loading={isTesting} disabled={!config?.is_configured}>
            {t("emailsettings.sendtest", "Send test email")}
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
