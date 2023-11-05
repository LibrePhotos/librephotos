import PropTypes from "prop-types";
import React, { useState } from "react";
import { animated, useSpring } from "react-spring";

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
    toprightoverlay,
    bottomleftoverlay,
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

    const { calcWidth, calcHeight, offsetX, offsetY } = getTileMeasurements({
      item,
      windowHeight,
      settings,
      containerWidth,
      containerOffsetTop,
    });

    // gridPosition is what has been set by the grid layout logic (in the parent component)
    const gridPosition = `translate3d(${item.style.translateX}px, ${item.style.translateY}px, 0)`;
    // screenCenter is positioning logic for when the item is active and expanded
    const screenCenter = `translate3d(${offsetX}px, ${offsetY}px, 0)`;

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

    const { width, height, transform, zIndex, marginLeft, marginRight, marginTop, marginBottom } = useSpring({
      transform: isExpanded ? screenCenter : gridPosition,
      zIndex: isExpanded ? 10 : 0, // 10 so that it takes a little longer before settling at 0
      width: getWidth(isExpanded, isSelected),
      height: getHeight(isExpanded, isSelected),
      marginLeft: isSelected && !isExpanded ? item.style.width * 0.05 : 0,
      marginRight: isSelected && !isExpanded ? item.style.width * 0.05 : 0,
      marginTop: isSelected && !isExpanded ? item.style.height * 0.05 : 0,
      marginBottom: isSelected && !isExpanded ? item.style.height * 0.05 : 0,
      config: { mass: 1.5, tension: 400, friction: 40 },
    });

    return (
      <animated.button
        className={`${styles.pigBtn}${isExpanded ? ` ${styles.pigBtnActive}` : ""} pig-btn`}
        onClick={event => handleClick(event, item)}
        style={{
          outline: isExpanded ? `${settings.gridGap}px solid ${settings.bgColor}` : null,
          backgroundColor: item.dominantColor,
          zIndex: zIndex.to(t => Math.round(t)),
          width: width.to(t => t),
          height: height.to(t => t),
          marginLeft: marginLeft.to(t => t),
          marginRight: marginRight.to(t => t),
          marginTop: marginTop.to(t => t),
          marginBottom: marginBottom.to(t => t),
          transform: transform.to(t => t),
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
            onLoad={() => setFullSizeLoaded(true)}
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
                key={item.id + isSelected}
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
        </div>
      </animated.button>
    );
  }
);

Tile.defaultProps = {
  toprightoverlay: null,
  bottomleftoverlay: null,
};

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
  activeTileUrl: PropTypes.string.isRequired,
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
