import React from "react";
import styles from "./styles.module.css";

// TypeScript types
type PigSettings = {
  gridGap: number;
  bgColor: string;
  thumbnailSize?: number;
  expandedSize?: number;
  headerSize?: "large" | "normal" | "small";
};

type Group = {
  groupTranslateY: number;
  height: number;
  location?: string;
  date: string;
};

type GroupHeaderProps = {
  settings: PigSettings;
  group: Group;
  activeTileUrl?: string;
  textAlignment?: "left" | "right";
  headerSize?: "large" | "normal" | "small";
};

export default function GroupHeader({
  settings,
  group,
  activeTileUrl,
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
          zIndex: activeTileUrl ? 1 : 2,
        }}
      >
        {textAlignment === "right" ? (
          <>
            <span className={`${styles.location} pig-header_location ${styles[headerSize]}`}>{group.location}</span>
            <span className={`${styles.date} pig-header_date ${styles[headerSize]}`}>{group.date}</span>
          </>
        ) : (
          <>
            <span className={`${styles.date} pig-header_date ${styles[headerSize]}`}>{group.date}</span>
            <span className={`${styles.location} pig-header_location ${styles[headerSize]}`}>{group.location}</span>
          </>
        )}
      </div>
    </header>
  );
}
