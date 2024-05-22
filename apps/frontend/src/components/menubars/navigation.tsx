import { rgba } from "@mantine/core";
import { createStyles } from "@mantine/emotion";
import type { Icon, IconProps } from "@tabler/icons-react";
import {
  IconAlbum as Album,
  IconBookmark as Bookmark,
  IconChartBar as ChartBar,
  IconChartLine as ChartLine,
  IconCloud as Cloud,
  IconDownload as Download,
  IconFaceId as FaceId,
  IconMap as Map,
  IconMoodSmile as MoodSmile,
  IconPhoto as Photo,
  IconShare as Share,
  IconTags as Tags,
  IconTrash as Trash,
  IconUpload as Upload,
  IconUsers as Users,
  IconVectorTriangle as VectorTriangle,
  IconWand as Wand,
  IconWorld as World,
} from "@tabler/icons-react";
import { ForwardRefExoticComponent, RefAttributes } from "react";

type SubmenuItem = {
  label: string;
  link: string;
  icon: any;
  header: string;
  separator: boolean;
  disabled: boolean;
  color: string;
};

type MenuItem = {
  label: string;
  link: string;
  icon: ForwardRefExoticComponent<Omit<IconProps, "ref"> & RefAttributes<Icon>>;
  color?: string;
  display?: boolean;
  submenu?: Array<Partial<SubmenuItem>>;
};

export function getNavigationItems(
  t: (s: string) => string,
  isAuthenticated: boolean,
  canAccess: boolean
): Array<MenuItem> {
  return [
    { label: t("sidemenu.photos"), link: "/", icon: Photo },
    {
      label: t("sidemenu.albums"),
      link: "/people",
      icon: Album,
      submenu: [
        { header: t("sidemenu.albums") },
        { label: t("sidemenu.people"), link: "/people", icon: Users },
        { label: t("sidemenu.places"), link: "/places", icon: Map },
        { label: t("sidemenu.things"), link: "/things", icon: Tags },
        { separator: true },
        { label: t("sidemenu.myalbums"), link: "/useralbums", icon: Bookmark },
        { label: t("sidemenu.autoalbums"), link: "/events", icon: Wand },
      ],
    },
    {
      label: t("sidemenu.datavizsmall"),
      link: "/placetree",
      icon: ChartLine,
      submenu: [
        { header: t("sidemenu.dataviz") },
        { label: t("sidemenu.placetree"), link: "/placetree", icon: VectorTriangle },
        { label: t("sidemenu.wordclouds"), link: "/wordclouds", icon: Cloud },
        { label: t("sidemenu.timeline"), link: "/timeline", icon: ChartBar },
        { label: t("sidemenu.socialgraph"), link: "/socialgraph", icon: Share },
        { label: t("sidemenu.facecluster"), link: "/facescatter", icon: MoodSmile },
      ],
    },
    { label: t("sidemenu.facerecognition"), link: "/faces", icon: FaceId },
    {
      label: t("sidemenu.sharing"),
      link: "/users/",
      display: isAuthenticated,
      icon: Users,
      submenu: [
        { header: t("sidemenu.sharing") },
        { label: t("sidemenu.publicphotos"), link: "/users/", icon: World, disabled: !canAccess },
        { label: t("sidemenu.youshared"), link: "/shared/fromme/photos/", icon: Upload },
        { label: t("sidemenu.sharedwithyou"), link: "/shared/tome/photos/", icon: Download },
      ],
    },
    { label: t("photos.deleted"), link: "/deleted", icon: Trash },
  ];
}

export const navigationStyles = createStyles((theme, _, u) => ({
  navbar: {
    backgroundColor: theme.colors.body,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    height: "100vh",
  },

  navbarLinks: {
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
    alignItems: "start",
  },

  navbarFooter: {
    paddingBottom: theme.spacing.sm,
    [u.dark]: {
      borderTop: `1px solid ${theme.colors.dark[4]}`,
    },
    [u.light]: {
      borderTop: `1px solid ${theme.colors.gray[2]}`,
    },
  },

  submenu: {
    display: "block",
  },

  text: {
    display: "flex",
    alignItems: "center",
    textDecoration: "none",
    fontSize: theme.fontSizes.sm,
    padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
    borderRadius: theme.radius.sm,
    fontWeight: 500,
  },

  hover: {
    "&:hover": {
      [u.dark]: {
        backgroundColor: theme.colors.dark[6],
      },
      [u.light]: {
        backgroundColor: theme.colors.gray[0],
      },
    },
  },

  link: {
    display: "flex",
    alignItems: "center",
    textDecoration: "none",
    fontSize: theme.fontSizes.sm,
    padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
    borderRadius: theme.radius.sm,
    fontWeight: 500,
    [u.dark]: {
      color: theme.colors.gray[3],
    },
    [u.light]: {
      color: theme.colors.dark[9],
    },

    "&:hover": {
      [u.dark]: {
        backgroundColor: theme.colors.dark[6],
      },
      [u.light]: {
        backgroundColor: theme.colors.gray[2],
      },
    },
  },

  linkIcon: {
    marginRight: theme.spacing.sm,
  },

  linkActive: {
    "&, &:hover": {
      [u.dark]: {
        backgroundColor: rgba(theme.colors[theme.primaryColor][8], 0.25),
      },
      [u.light]: {
        backgroundColor: theme.colors[theme.primaryColor][0],
      },
    },
  },
}));
