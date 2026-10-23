import { photoLicenseUrl, type PhotoLicenseId } from "@librephotos/api-client";
import { ActionIcon, Anchor, CopyButton, Group, Paper, Stack, Text, Textarea, Title, Tooltip } from "@mantine/core";
import {
  IconAlertCircle,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconLicense,
  IconX,
  type Icon,
} from "@tabler/icons-react";
import type { ParseKeys, TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { LicenseBadge } from "./LicenseBadge";
import { asLicense, LICENSES, type LicenseTerms } from "./photoLicenses";

/** A photo's rights as a public page gets them; each null when not stated. */
type Rights = Readonly<{ license: string | null; creator: string | null; copyright: string | null }>;

type TermRow = Readonly<{ icon: Icon; color: string; text: ParseKeys }>;

const ALLOWED: Pick<TermRow, "icon" | "color"> = { icon: IconCheck, color: "teal" };
const DENIED: Pick<TermRow, "icon" | "color"> = { icon: IconX, color: "red" };
const REQUIRED: Pick<TermRow, "icon" | "color"> = { icon: IconAlertCircle, color: "orange" };

/** "What you may do": a mark and words per row; the words say it, the mark is decoration. */
function termRows(terms: LicenseTerms | null): TermRow[] {
  if (!terms) return [{ ...DENIED, text: "rights.public.reuseNo" }];
  const rows: TermRow[] = [
    terms.adapt ? { ...ALLOWED, text: "rights.public.shareAdapt" } : { ...ALLOWED, text: "rights.public.share" },
  ];
  if (!terms.adapt) rows.push({ ...DENIED, text: "rights.public.adaptNo" });
  rows.push(
    terms.commercial
      ? { ...ALLOWED, text: "rights.public.commercial" }
      : { ...DENIED, text: "rights.public.commercialNo" }
  );
  if (terms.credit) rows.push({ ...REQUIRED, text: "rights.public.credit" });
  if (terms.shareAlike) rows.push({ ...REQUIRED, text: "rights.public.shareAlike" });
  return rows;
}

/** The attribution a visitor copies: who made it, where it is, and its license with the deed. */
function creditLine(t: TFunction, license: PhotoLicenseId, creator: string | null, source: string): string {
  const name = t(LICENSES[license].name);
  const url = photoLicenseUrl(license);
  const licensed = url ? `${name} (${url})` : name;
  return creator
    ? t("rights.public.creditLine", { creator, source, license: licensed })
    : t("rights.public.creditLineNoCreator", { source, license: licensed });
}

/** "How to credit": the line to copy, selectable where the browser cannot copy (plain HTTP). */
function HowToCredit({ line }: Readonly<{ line: string }>) {
  const { t } = useTranslation();
  const canCopy = window.isSecureContext && typeof navigator.clipboard?.writeText === "function";
  return (
    <Paper withBorder p="xs" radius="sm">
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm" fw={600}>
            {t("rights.public.howToCredit")}
          </Text>
          {canCopy && (
            <CopyButton value={line}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? t("rights.public.copied") : t("rights.public.copy")}>
                  <ActionIcon
                    variant="subtle"
                    color={copied ? "teal" : "gray"}
                    size="sm"
                    onClick={copy}
                    aria-label={t("rights.public.copy")}
                  >
                    {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          )}
        </Group>
        <Textarea
          value={line}
          readOnly
          rows={4}
          size="xs"
          aria-label={t("rights.public.howToCredit")}
          onFocus={event => event.currentTarget.select()}
        />
      </Stack>
    </Paper>
  );
}

/**
 * The License section of a public photo (#425): the license with its marks and deed, the copyright
 * notice and creator, what a visitor may do, and the line to credit the photo with. It follows no
 * sharing switch; the server sends a public page's visitor rights only for a photo with a license.
 * Nothing when the photo states no rights.
 */
export function PublicRightsSection({ rights }: Readonly<{ rights: Rights | null | undefined }>) {
  const { t } = useTranslation();
  if (!rights) return null;
  const license = asLicense(rights.license);
  if (!license && !rights.copyright && !rights.creator) return null;
  const url = license ? photoLicenseUrl(license) : null;
  return (
    <Stack gap="xs">
      <Group gap="xs" wrap="nowrap">
        <IconLicense aria-hidden />
        <Title order={4}>{t("rights.public.title")}</Title>
      </Group>
      {license && <LicenseBadge license={license} />}
      {rights.copyright && <Text size="sm">{rights.copyright}</Text>}
      {rights.creator && (
        <Text size="sm" c="dimmed">
          {t("rights.public.by", { creator: rights.creator })}
        </Text>
      )}
      {license && (
        <>
          <Text size="sm">{t(LICENSES[license].summary)}</Text>
          <Stack gap={4}>
            {termRows(LICENSES[license].terms).map(row => (
              <Group key={row.text} gap={6} wrap="nowrap">
                <Text component="span" c={row.color} lh={0} aria-hidden>
                  <row.icon size={16} />
                </Text>
                <Text size="sm">{t(row.text)}</Text>
              </Group>
            ))}
          </Stack>
          {url && (
            <Anchor href={url} target="_blank" rel="noopener noreferrer" size="sm">
              <Group gap={4} component="span" wrap="nowrap">
                {t(LICENSES[license].title)}
                <IconExternalLink size={12} aria-hidden />
              </Group>
            </Anchor>
          )}
          {LICENSES[license].terms?.credit && (
            <HowToCredit line={creditLine(t, license, rights.creator, window.location.href)} />
          )}
        </>
      )}
    </Stack>
  );
}
