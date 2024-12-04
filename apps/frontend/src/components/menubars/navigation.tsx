import { MantineColor } from "@mantine/core";
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
  color: MantineColor;
};

type MenuItem = {
  label: string;
  link: string;
  icon: ForwardRefExoticComponent<Omit<IconProps, "ref"> & RefAttributes<Icon>>;
  color?: MantineColor;
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
    { label: t("photos.deleted"), link: "/deleted", icon: Trash, color: "gray" },
  ];
}
