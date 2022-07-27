import { createStyles } from "@mantine/core";
import type { Icon } from "tabler-icons-react";
import {
  Album,
  Bookmark,
  ChartBar,
  ChartLine,
  Cloud,
  Download,
  FaceId,
  Heart,
  Map,
  MoodSmile,
  Photo,
  Share,
  Tags,
  Trash,
  Upload,
  Users,
  VectorTriangle,
  Wand,
  World,
} from "tabler-icons-react";

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
  icon: Icon;
  color: string;
  display?: boolean;
  submenu?: Array<Partial<SubmenuItem>>;
};

export function getNavigationItems(
  t: (s: string) => string,
  isAuthenticated: boolean,
  canAccess: boolean
): Array<MenuItem> {
  return [
    { label: t("sidemenu.photos"), link: "/", icon: Photo, color: "green" },
    {
      label: t("sidemenu.albums"),
      link: "/people",
      icon: Album,
      color: "blue",
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
      color: "yellow",
      submenu: [
        { header: t("sidemenu.dataviz") },
        { label: t("sidemenu.placetree"), link: "/placetree", icon: VectorTriangle },
        { label: t("sidemenu.wordclouds"), link: "/wordclouds", icon: Cloud },
        { label: t("sidemenu.timeline"), link: "/timeline", icon: ChartBar },
        { label: t("sidemenu.socialgraph"), link: "/socialgraph", icon: Share },
        { label: t("sidemenu.facecluster"), link: "/facescatter", icon: MoodSmile },
      ],
    },
    { label: t("sidemenu.facerecognition"), link: "/faces", icon: FaceId, color: "orange" },
    {
      label: t("sidemenu.sharing"),
      link: "/users/",
      display: isAuthenticated,
      icon: Users,
      color: "red",
      submenu: [
        { header: t("sidemenu.sharing") },
        { label: t("sidemenu.publicphotos"), link: "/users/", icon: World, disabled: !canAccess },
        { label: t("sidemenu.youshared"), link: "/shared/fromme/photos/", icon: Upload, color: "red" },
        { label: t("sidemenu.sharedwithyou"), link: "/shared/tome/photos/", icon: Download, color: "green" },
      ],
    },
    { label: t("photos.deleted"), link: "/deleted", icon: Trash, color: "black" },
    { label: t("sponsorus"), link: "https://github.com/sponsors/derneuere", icon: Heart, color: "pink" },
  ];
}

export const navigationStyles = createStyles((theme, _params, getRef) => {
  const icon = getRef("icon");
  return {
    header: {
      paddingBottom: theme.spacing.md,
      marginBottom: theme.spacing.md * 1.5,
      borderBottom: `1px solid ${theme.colorScheme === "dark" ? theme.colors.dark[4] : theme.colors.gray[2]}`,
    },

    footer: {
      paddingTop: theme.spacing.md,
      marginTop: theme.spacing.md,
      borderTop: `1px solid ${theme.colorScheme === "dark" ? theme.colors.dark[4] : theme.colors.gray[2]}`,
    },

    link: {
      ...theme.fn.focusStyles(),
      display: "flex",
      alignItems: "center",
      textDecoration: "none",
      fontSize: theme.fontSizes.sm,
      color: theme.colorScheme === "dark" ? theme.colors.dark[1] : theme.colors.gray[7],
      padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
      borderRadius: theme.radius.sm,
      fontWeight: 500,

      "&:hover": {
        backgroundColor: theme.colorScheme === "dark" ? theme.colors.dark[6] : theme.colors.gray[0],
        color: theme.colorScheme === "dark" ? theme.white : theme.black,
      },
    },

    linkIcon: {
      ref: icon,
      marginRight: theme.spacing.sm,
    },

    linkActive: {
      "&, &:hover": {
        backgroundColor:
          theme.colorScheme === "dark"
            ? theme.fn.rgba(theme.colors[theme.primaryColor][8], 0.25)
            : theme.colors[theme.primaryColor][0],
      },
    },
  };
});
