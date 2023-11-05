import PropTypes from "prop-types";
import React from "react";

import styles from "./styles.module.css";

function GroupHeader({ settings, group, activeTileUrl }) {
  return (
    <header
      className={styles.headerPositioner}
      style={{
        top: `${group.groupTranslateY}px`,
        height: `${group.height - settings.gridGap}px`,
      }}
    >
      <div
        className={`${styles.headerInner} pig-header`}
        style={{
          backgroundColor: settings.bgColor,
          zIndex: activeTileUrl ? 1 : 2,
        }}
      >
        <span className={`${styles.location} pig-header_location`}>{group.location}</span>
        <span className={`${styles.date} pig-header_date`}>{group.date}</span>
      </div>
    </header>
  );
}

GroupHeader.propTypes = {
  settings: PropTypes.shape({
    gridGap: PropTypes.number,
    bgColor: PropTypes.string,
    thumbnailSize: PropTypes.number,
    expandedSize: PropTypes.number,
  }).isRequired,
  group: PropTypes.shape({
    groupTranslateY: PropTypes.number,
    height: PropTypes.number,
    location: PropTypes.string,
    date: PropTypes.string,
  }).isRequired,
  activeTileUrl: PropTypes.string.isRequired,
};

export default GroupHeader;
