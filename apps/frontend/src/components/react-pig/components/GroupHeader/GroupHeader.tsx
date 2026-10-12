import React from "react";
import type { HeaderSize, ImageItem, PigSettings } from "../../types";
import styles from "./styles.module.css";

// A laid-out date group (Pig's GroupedImageItem after computeLayoutGroups).
type Group = {
  groupTranslateY: number;
  height: number;
  location?: string | null;
  date: string | null;
};

type GroupHeaderProps = {
  settings: Pick<PigSettings, "gridGap" | "bgColor">;
  group: Group;
  activeTileId?: ImageItem["id"] | null;
  textAlignment?: "left" | "right";
  headerSize?: HeaderSize;
};

export default function GroupHeader({
  settings,
  group,
  activeTileId = null,
  textAlignment = "right",
  headerSize = "large",
}: GroupHeaderProps) {
  return (
    <header
      className={styles.headerPositioner}
      style={{
        top: `${group.groupTranslateY}px`,
        height: `${group.height - settings.gridGap}px`,
      }}
    >
      <div
        className={`${styles.headerInner} pig-header ${textAlignment === "left" ? styles.leftAligned : styles.rightAligned} ${styles[headerSize]}`}
        style={{
          backgroundColor: settings.bgColor,
          zIndex: activeTileId !== null ? 1 : 2,
        }}
      >
        {textAlignment === "right" ? (
          <>
            <span
              className={`${styles.location} pig-header_location ${styles[headerSize]}`}
              title={group.location ?? undefined}
            >
              {group.location}
            </span>
            <span className={`${styles.date} pig-header_date ${styles[headerSize]}`}>{group.date}</span>
          </>
        ) : (
          <>
            <span className={`${styles.date} pig-header_date ${styles[headerSize]}`}>{group.date}</span>
            <span
              className={`${styles.location} pig-header_location ${styles[headerSize]}`}
              title={group.location ?? undefined}
            >
              {group.location}
            </span>
          </>
        )}
      </div>
    </header>
  );
}
