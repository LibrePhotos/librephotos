import type { UserPlaceIcon } from "@librephotos/api-client";
import {
  IconBriefcase,
  IconHeart,
  IconHome,
  IconMapPin,
  IconSchool,
  IconStar,
  type TablerIcon,
} from "@tabler/icons-react";
import type { ParseKeys } from "i18next";

/** The icon each place icon value draws (#1365). */
export const PLACE_ICONS: Readonly<Record<UserPlaceIcon, TablerIcon>> = {
  pin: IconMapPin,
  home: IconHome,
  work: IconBriefcase,
  school: IconSchool,
  heart: IconHeart,
  star: IconStar,
};

/** What each place icon is called, for its radio button and screen readers. */
export const PLACE_ICON_LABELS: Readonly<Record<UserPlaceIcon, ParseKeys>> = {
  pin: "yourplaces.icon.pin",
  home: "yourplaces.icon.home",
  work: "yourplaces.icon.work",
  school: "yourplaces.icon.school",
  heart: "yourplaces.icon.heart",
  star: "yourplaces.icon.star",
};
