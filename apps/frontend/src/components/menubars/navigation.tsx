import { MantineColor } from "@mantine/core";
import type { Icon } from "@tabler/icons-react";
import {
  IconAlbum as Album,
  IconChartLine as ChartLine,
  IconDownload as Download,
  IconFaceId as FaceId,
  IconPhoto as Photo,
  IconTrash as Trash,
  IconUpload as Upload,
  IconUsers as Users,
  IconWorld as World,
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
};

export function getNavigationItems(
  t: TFunction<"translation", undefined>,
  isAuthenticated: boolean,
  canAccess: boolean
): Array<MenuItem> {
  return [
    { label: t("sidemenu.photos"), link: "/", icon: Photo, color: "green" },
    { label: t("sidemenu.albums"), link: "/album", icon: Album, color: "blue" },
    { label: t("sidemenu.statistics"), link: "/statistics", icon: ChartLine, color: "yellow" },
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
