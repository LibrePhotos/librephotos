import { motion } from "motion/react";
import PropTypes from "prop-types";
import React, { useState } from "react";
import getImageHeight from "../../utils/getImageHeight";
import getTileMeasurements from "../../utils/getTileMeasurements";
import styles from "./styles.module.css";

const Tile = React.memo(
  ({
    item,
    useLqip,
    containerWidth,
    containerOffsetTop,
    getUrl,
    activeTileUrl,
    handleClick,
    handleSelection,
    selected,
    selectable,
    windowHeight,
    scrollSpeed,
    settings,
    toprightoverlay = null,
    bottomleftoverlay = null,
    bottomrightoverlay = null,
  }) => {
    const isTemp = !!item.isTemp;
    const isSelectable = selectable;
    const isSelected = selected;
    const isExpanded = activeTileUrl === item.url;
    const isVideo =
      !isTemp &&
      (item.url.includes(".mp4") ||
        item.url.includes(".mov") ||
        (item.type !== undefined && item.type.includes("video")));
    const [isFullSizeLoaded, setFullSizeLoaded] = useState(!!isVideo);
    const TopRightOverlay = toprightoverlay;
    const BottomLeftOverlay = bottomleftoverlay;
    const BottomRightOverlay = bottomrightoverlay;

    const { calcWidth, calcHeight, offsetX, offsetY } = getTileMeasurements({
      item,
      windowHeight,
      settings,
      containerWidth,
      containerOffsetTop,
    });

    function getWidth(exp, sel) {
      if (exp) {
        return `${Math.ceil(calcWidth)}px`;
      }
      if (sel) {
        return `${item.style.width - item.style.width * 0.1}px`;
      }
      return `${item.style.width}px`;
    }

    function getHeight(exp, sel) {
      if (exp) {
        return `${Math.ceil(calcHeight)}px`;
      }
      if (sel) {
        return `${item.style.height - item.style.height * 0.1}px`;
      }
      return `${item.style.height}px`;
    }

    const springTransition = { type: "spring", mass: 1.5, stiffness: 400, damping: 40 };

    return (
      <motion.button
        className={`${styles.pigBtn}${isExpanded ? ` ${styles.pigBtnActive}` : ""} pig-btn`}
        onClick={event => handleClick(event, item)}
        animate={{
          width: getWidth(isExpanded, isSelected),
          height: getHeight(isExpanded, isSelected),
          zIndex: isExpanded ? 10 : 0,
          marginLeft: isSelected && !isExpanded ? item.style.width * 0.05 : 0,
          marginRight: isSelected && !isExpanded ? item.style.width * 0.05 : 0,
          marginTop: isSelected && !isExpanded ? item.style.height * 0.05 : 0,
          marginBottom: isSelected && !isExpanded ? item.style.height * 0.05 : 0,
          x: isExpanded ? offsetX : item.style.translateX,
          y: isExpanded ? offsetY : item.style.translateY,
        }}
        transition={springTransition}
        style={{
          outline: isExpanded ? `${settings.gridGap}px solid ${settings.bgColor}` : null,
          backgroundColor: item.dominantColor,
          position: "absolute",
          left: 0,
          top: 0,
        }}
      >
        {useLqip && !isTemp && (
          // LQIP
          <img
            className={`${styles.pigImg} ${styles.pigThumbnail}${
              isFullSizeLoaded ? ` ${styles.pigThumbnailLoaded}` : ""
            }`}
            src={getUrl(item.url, settings.thumbnailSize)}
            loading="lazy"
            width={item.style.width}
            height={item.style.height}
            alt=""
          />
        )}

        {scrollSpeed === "slow" && !isVideo && !isTemp && (
          // grid image
          <img
            className={`${styles.pigImg} ${styles.pigFull}${isFullSizeLoaded ? ` ${styles.pigFullLoaded}` : ""}`}
            src={getUrl(item.url, getImageHeight(containerWidth))}
            alt=""
            onLoad={() => {
              setFullSizeLoaded(true);
              // Force a re-render to ensure the blur filter is removed
              setTimeout(() => {
                const imgElements = document.querySelectorAll(`.${styles.pigThumbnail}`);
                imgElements.forEach(img => {
                  if (img.src.includes(item.url.split(";")[0])) {
                    img.classList.add(styles.pigThumbnailLoaded);
                  }
                });
              }, 50);
            }}
          />
        )}

        {scrollSpeed === "slow" && isVideo && !isTemp && (
          <video
            className={`${styles.pigImg} ${styles.pigThumbnail}${
              isFullSizeLoaded ? ` ${styles.pigThumbnailLoaded}` : ""
            }`}
            src={getUrl(item.url, getImageHeight(containerWidth))}
            onCanPlay={() => setFullSizeLoaded(true)}
            onMouseOver={event => event.target.play()}
            onFocus={event => event.target.play()}
            onMouseOut={event => event.target.pause()}
            onBlur={event => event.target.pause()}
            muted
            loop
            playsInline
          />
        )}

        {isExpanded && !isVideo && !isTemp && (
          // full size expanded image
          <img className={styles.pigImg} src={getUrl(item.url, settings.expandedSize)} alt="" />
        )}

        {isExpanded && isVideo && !isTemp && (
          // full size expanded video
          <video
            className={styles.pigImg}
            src={getUrl(item.url, settings.expandedSize)}
            onMouseOver={event => event.target.play()}
            onFocus={event => event.target.play()}
            onMouseOut={event => event.target.pause()}
            onBlur={event => event.target.pause()}
            muted
            loop
            playsInline
          />
        )}
        <div>
          <div className={styles.overlaysTopLeft}>
            {isSelectable && (
              <input
                key={`checkbox-${item.id}-${isSelected}`}
                type="checkbox"
                className={styles.checkbox}
                defaultChecked={isSelected}
                onClick={event => {
                  event.stopPropagation();
                  handleSelection(item);
                }}
              />
            )}
          </div>
          <div className={styles.overlaysTopRight}>{TopRightOverlay && <TopRightOverlay item={item} />}</div>
          <div className={styles.overlaysBottomLeft}>{BottomLeftOverlay && <BottomLeftOverlay item={item} />}</div>
          <div className={styles.overlaysBottomRight}>{BottomRightOverlay && <BottomRightOverlay item={item} />}</div>
        </div>
      </motion.button>
    );
  }
);

const ItemType = PropTypes.shape({
  id: PropTypes.string,
  dominantColor: PropTypes.string,
  isTemp: PropTypes.bool,
  url: PropTypes.string,
  type: PropTypes.string,
  style: PropTypes.shape({
    height: PropTypes.number,
    width: PropTypes.number,
    translateX: PropTypes.number,
    translateY: PropTypes.number,
  }),
});

const SettingsType = PropTypes.shape({
  gridGap: PropTypes.number,
  bgColor: PropTypes.string,
  thumbnailSize: PropTypes.number,
  expandedSize: PropTypes.number,
});

Tile.propTypes = {
  item: ItemType.isRequired,
  useLqip: PropTypes.bool.isRequired,
  containerWidth: PropTypes.number.isRequired,
  containerOffsetTop: PropTypes.number.isRequired,
  getUrl: PropTypes.func.isRequired,
  activeTileUrl: PropTypes.string,
  handleClick: PropTypes.func.isRequired,
  handleSelection: PropTypes.func.isRequired,
  selected: PropTypes.bool.isRequired,
  selectable: PropTypes.bool.isRequired,
  windowHeight: PropTypes.number.isRequired,
  scrollSpeed: PropTypes.string.isRequired,
  settings: SettingsType.isRequired,
  toprightoverlay: PropTypes.func,
  bottomleftoverlay: PropTypes.func,
};

export default Tile;
