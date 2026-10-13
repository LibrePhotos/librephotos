import { Loader } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconAlertTriangle, IconMapPin } from "@tabler/icons-react";
import React from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useReverseGeocodeQuery } from "../../api_client/geocode";
import { PlaceLines } from "./PlaceLines";

// How long a dragged or clicked marker rests before its place is looked up.
const LOOKUP_DELAY_MS = 400;

type Props = Readonly<{
  position: readonly [number, number];
  /** The place name the server already has for this position (the photo's own); skips the lookup. */
  knownPlace?: string;
}>;

/**
 * The picked spot under the map: its place name (as the photo will get it on save) above the
 * coordinates. The name is looked up once the marker rests; the lookup never blocks Save.
 */
export function PickedPlace({ position, knownPlace }: Props) {
  const [settled] = useDebouncedValue(position, LOOKUP_DELAY_MS);
  const resting = settled[0] === position[0] && settled[1] === position[1];
  const lookup = useReverseGeocodeQuery(knownPlace || !resting ? null : position);
  const coordinates = `${position[0].toFixed(6)}, ${position[1].toFixed(6)}`;

  let content: ReactNode;
  if (knownPlace) {
    content = <PlaceLines icon={<PinIcon />} title={knownPlace} detail={coordinates} tone="bold" />;
  } else if (!resting || lookup.isPending) {
    content = <LookingUp coordinates={coordinates} />;
  } else {
    content = <LookupResult coordinates={coordinates} enabled={lookup.data?.enabled} place={lookup.data?.place} />;
  }
  return (
    <div aria-live="polite" data-testid="picked-place">
      {content}
    </div>
  );
}

function LookingUp({ coordinates }: Readonly<{ coordinates: string }>) {
  const { t } = useTranslation();
  return (
    <PlaceLines icon={<Loader size={16} />} title={t("locationpicker.looking_up")} detail={coordinates} tone="dimmed" />
  );
}

function LookupResult({
  coordinates,
  enabled,
  place,
}: Readonly<{ coordinates: string; enabled?: boolean; place?: string | null }>) {
  const { t } = useTranslation();
  if (place) return <PlaceLines icon={<PinIcon />} title={place} detail={coordinates} tone="bold" />;
  if (enabled === false) {
    return (
      <PlaceLines icon={<PinIcon />} title={coordinates} detail={t("locationpicker.place_names_off")} tone="bold" />
    );
  }
  // No name for the spot, or the lookup failed: saving tries again.
  return (
    <PlaceLines
      icon={<IconAlertTriangle size={16} color="var(--mantine-color-orange-6)" />}
      title={t("locationpicker.place_unavailable")}
      detail={`${coordinates} · ${t("locationpicker.place_unavailable_hint")}`}
      tone="dimmed"
    />
  );
}

function PinIcon() {
  return <IconMapPin size={16} color="var(--mantine-color-blue-6)" />;
}
