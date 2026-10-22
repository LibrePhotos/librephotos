import React from "react";
import type { HeaderSize, ImageItem, PigSettings } from "../../types";
import styles from "./styles.module.css";

// A laid-out date group (Pig's GroupedImageItem after computeLayoutGroups).
type Group = {
  groupTranslateY: number;
  height: number;
  location?: string | null;
  date: string | null;
  note?: string | null;
};

type GroupHeaderProps = {
  settings: Pick<PigSettings, "gridGap" | "bgColor">;
  group: Group;
  activeTileId?: ImageItem["id"] | null;
  textAlignment?: "left" | "right";
  headerSize?: HeaderSize;
};

// The dimmed note beside the date (a person's age, #2751); nothing without one.
function Note({ note, headerSize }: Readonly<{ note?: string | null; headerSize: HeaderSize }>) {
  if (!note) return null;
  return <span className={`${styles.note} pig-header_note ${styles[headerSize]}`}>{note}</span>;
}

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
            <Note note={group.note} headerSize={headerSize} />
            <span className={`${styles.date} pig-header_date ${styles[headerSize]}`}>{group.date}</span>
          </>
        ) : (
          <>
            <span className={`${styles.date} pig-header_date ${styles[headerSize]}`}>{group.date}</span>
            <Note note={group.note} headerSize={headerSize} />
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
