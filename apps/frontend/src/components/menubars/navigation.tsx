import { MantineColor } from "@mantine/core";
import type { Icon } from "@tabler/icons-react";
import {
  IconAlbum as Album,
  IconPhoto as Photo,
  IconSparkles as Sparkles,
  IconLayersSubtract as Stacks,
  IconTrash as Trash,
  IconUsers as Users,
} from "@tabler/icons-react";
import { TFunction } from "i18next";

type SubmenuItem = {
  label: string;
  link: string;
  icon: any;
  header: string;
  separator: boolean;
  disabled: boolean;
  color: MantineColor;
};

type MenuItem = {
  label: string;
  link: string;
  icon: Icon;
  color?: MantineColor;
  display?: boolean;
  submenu?: Array<Partial<SubmenuItem>>;
  /** Paths whose sub-pages also highlight this entry; defaults to [link]. */
  activePrefixes?: string[];
};

/** Whether a nav entry is the current section, e.g. Albums on /album/user/3. */
export function isNavItemActive(item: Pick<MenuItem, "link" | "activePrefixes">, pathname: string): boolean {
  return (item.activePrefixes ?? [item.link]).some(prefix =>
    // "/" prefixes every path, so the timeline entry only matches itself.
    prefix === "/" ? pathname === "/" : pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function getNavigationItems(t: TFunction<"translation", undefined>, isAuthenticated: boolean): Array<MenuItem> {
  return [
    {
      label: t("sidemenu.photos"),
      link: "/",
      icon: Photo,
      color: "green",
      // The views the Photos header dropdown switches between.
      activePrefixes: ["/", "/photos", "/favorites", "/videos", "/recent", "/hidden", "/notimestamp", "/screenshots"],
    },
    { label: t("sidemenu.albums"), link: "/album", icon: Album, color: "blue" },
    {
      label: t("sidemenu.memories", "Memories"),
      link: "/memories",
      display: isAuthenticated,
      icon: Sparkles,
      color: "grape",
    },
    {
      label: t("sidemenu.sharing"),
      link: "/sharing",
      display: isAuthenticated,
      icon: Users,
      color: "red",
    },
    {
      label: t("sidemenu.organizing", "Organizing"),
      link: "/organizing/duplicates",
      activePrefixes: ["/organizing"],
      display: isAuthenticated,
      icon: Stacks,
      color: "yellow",
    },
    { label: t("photos.deleted"), link: "/deleted", icon: Trash, color: "gray" },
  ];
}
