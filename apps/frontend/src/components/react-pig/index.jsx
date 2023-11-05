import { debounce, throttle } from "lodash";
import PropTypes from "prop-types";
import React, { Component } from "react";

import calcRenderableItems from "./calcRenderableItems";
import GroupHeader from "./components/GroupHeader/GroupHeader";
import Tile from "./components/Tile/Tile";
import computeLayout from "./computeLayout";
import computeLayoutGroups from "./computeLayoutGroups";
import styles from "./styles.module.css";
import getScrollSpeed from "./utils/getScrollSpeed";
import getUrl from "./utils/getUrl";
import sortByDate from "./utils/sortByDate";

export function addTempElementsToGroups(photosGroupedByDate) {
  photosGroupedByDate.forEach(group => {
    for (let i = 0; i < group.numberOfItems; i += 1) {
      group.items.push({ id: i, aspectRatio: 1, isTemp: true });
    }
  });
}

export function addTempElementsToFlatList(photosCount) {
  const tempPhotos = [];
  for (let i = 0; i < photosCount; i += 1) {
    tempPhotos.push({ id: i, aspectRatio: 1, isTemp: true });
  }
  return tempPhotos;
}

export default class Pig extends Component {
  constructor(props) {
    super(props);

    if (!props.imageData) throw new Error("imageData is missing");

    // if getUrl has been provided as a prop, use it. otherwise use the default getUrl from /utils
    this.getUrl = props.getUrl || getUrl;

    // if handleClick has been provided as a prop, use it. otherwise use the defaultHandleClick
    this.handleClick = props.handleClick || this.defaultHandleClick;

    this.selectable = props.selectable || false;
    this.handleSelection = props.handleSelection || this.defaultHandleSelection;
    this.imageData = props.imageData;
    this.numberOfItems = props.numberOfItems || this.imageData.length;
    this.scaleOfImages = props.scaleOfImages || 1;
    this.updateGroups = props.updateGroups || function onUpdateGroups() {};
    this.updateItems = props.updateItems || function onUpdateItems() {};
    // if sortFunc has been provided as a prop, use it
    if (props.sortFunc) this.imageData.sort(props.sortFunc);
    else if (props.sortByDate) this.imageData = sortByDate(this.imageData);

    // check grouping ability
    if (props.groupByDate && !this.imageData[0].items) {
      // eslint-disable-next-line no-console
      console.error(`Data provided is not grouped yet. Please check the docs, you'll need to use groupify.js`);
    }
    if (!props.groupByDate && this.imageData[0].items) {
      // eslint-disable-next-line no-console
      console.error(`Data provided is grouped, please include the groupByDate prop`);
    }

    this.state = {
      renderedItems: [],
      selectedItems: [],
      scrollSpeed: "slow",
      activeTileUrl: null,
    };

    this.scrollThrottleMs = 300;
    if (typeof window !== "undefined") {
      this.windowHeight = window.innerHeight;
    } else {
      this.windowHeight = 1000;
      this.containerOffsetTop = null;
    } // arbitrary height
    this.totalHeight = 0;

    this.containerRef = React.createRef();
    this.minAspectRatio = null;
    this.latestYOffset = 0;
    this.previousYOffset = 0;
    this.scrollDirection = "down";

    this.settings = {
      gridGap: props.gridGap,
      bgColor: props.bgColor,
      primaryImageBufferHeight: props.primaryImageBufferHeight,
      secondaryImageBufferHeight: props.secondaryImageBufferHeight,
      expandedSize: props.expandedSize,
      thumbnailSize: props.thumbnailSize,
      groupByDate: props.groupByDate,
      breakpoint: props.breakpoint,
      groupGapSm: props.groupGapSm,
      groupGapLg: props.groupGapLg,
    };

    if (typeof window === "undefined") return;

    this.throttledScroll = throttle(this.onScroll, this.scrollThrottleMs);
    this.debouncedResize = debounce(this.onResize, 500);
  }

  componentDidMount() {
    this.container = this.containerRef.current;
    this.containerOffsetTop = this.container.offsetTop;
    this.containerWidth = this.container.offsetWidth;

    this.imageData = this.getUpdatedImageLayout();
    this.setRenderedItems(this.imageData);

    if (typeof window === "undefined") return;
    window.addEventListener("scroll", this.throttledScroll);
    window.addEventListener("resize", this.debouncedResize);
  }

  componentDidUpdate(prevProps) {
    if (this.props !== prevProps) {
      const { imageData } = this.props;
      this.imageData = imageData;
      this.imageData = this.getUpdatedImageLayout();
      this.container.style.height = `${this.totalHeight}px`; // set the container height again based on new layout
      this.containerWidth = this.container.offsetWidth;
      this.containerOffsetTop = this.container.offsetTop;
      this.windowHeight = window.innerHeight;
      this.setRenderedItems(this.imageData);
    }
  }

  componentWillUnmount() {
    window.removeEventListener("scroll", this.throttledScroll);
    window.removeEventListener("resize", this.debouncedResize);
  }

  setRenderedItems(imageData) {
    // Set the container height, only need to do this once.
    if (!this.container.style.height) this.container.style.height = `${this.totalHeight}px`;

    const renderedItems = calcRenderableItems({
      containerOffsetTop: this.containerOffsetTop,
      scrollDirection: this.scrollDirection,
      settings: this.settings,
      latestYOffset: this.latestYOffset,
      imageData,
      windowHeight: this.windowHeight,
      updateGroups: this.updateGroups,
      updateItems: this.updateItems,
      scaleOfImages: this.scaleOfImages,
    });

    this.setState({ renderedItems });
  }

  onScroll = () => {
    this.previousYOffset = this.latestYOffset || window.pageYOffset;
    this.latestYOffset = window.pageYOffset;
    this.scrollDirection = this.latestYOffset > this.previousYOffset ? "down" : "up";

    window.requestAnimationFrame(() => {
      this.setRenderedItems(this.imageData);

      // measure users scrolling speed and set it to state, used for conditional tile rendering
      const scrollSpeed = getScrollSpeed(this.latestYOffset, this.scrollThrottleMs, speed => {
        this.setState({ scrollSpeed: speed }); // scroll idle callback
      });
      this.setState({ scrollSpeed });

      // dismiss any active Tile
      const { activeTileUrl } = this.state;
      if (activeTileUrl) this.setState({ activeTileUrl: null });
    });
  };

  onResize = () => {
    this.imageData = this.getUpdatedImageLayout();
    this.setRenderedItems(this.imageData);
    this.container.style.height = `${this.totalHeight}px`; // set the container height again based on new layout
    this.containerWidth = this.container.offsetWidth;
    this.containerOffsetTop = this.container.offsetTop;
    this.windowHeight = window.innerHeight;
  };

  getUpdatedImageLayout() {
    const wrapperWidth = this.container.offsetWidth;

    if (this.settings.groupByDate) {
      const { imageData, newTotalHeight } = computeLayoutGroups({
        wrapperWidth,
        minAspectRatio: this.minAspectRatio,
        imageData: this.imageData,
        settings: this.settings,
        scaleOfImages: this.scaleOfImages,
      });

      this.totalHeight = newTotalHeight;
      return imageData;
    }
    const { imageData, newTotalHeight } = computeLayout({
      wrapperWidth,
      minAspectRatio: this.minAspectRatio,
      imageData: this.imageData,
      settings: this.settings,
      scaleOfImages: this.scaleOfImages,
      numberOfItems: this.numberOfItems,
    });

    this.totalHeight = newTotalHeight;
    return imageData;
  }

  defaultHandleSelection = item => {
    let { newSelectedItems } = this.state;
    if (newSelectedItems.includes(item)) {
      newSelectedItems = newSelectedItems.filter(value => value !== item);
    } else {
      newSelectedItems = newSelectedItems.concat(item);
    }
    this.setState({ selectedItems: newSelectedItems });
  };

  defaultHandleClick = (event, item) => {
    // if an image is already the width of the container, don't expand it on click
    if (item.style.width >= this.containerWidth) {
      this.setState({ activeTileUrl: null });
      return;
    }

    const { activeTileUrl } = this.state;
    this.setState({
      // if Tile is already active, deactivate it
      activeTileUrl: item.url !== activeTileUrl ? item.url : null,
    });
  };

  renderTile = item => {
    const { useLqip, selectedItems, thumbnailSize, toprightoverlay, bottomleftoverlay } = this.props;
    const { selectedItems: stateSelectedItems, activeTileUrl, scrollSpeed } = this.state;
    return (
      <Tile
        key={item.url}
        useLqip={useLqip}
        windowHeight={this.windowHeight}
        containerWidth={this.containerWidth}
        containerOffsetTop={this.containerOffsetTop}
        item={item}
        gridGap={this.settings.gridGap}
        getUrl={this.getUrl}
        handleClick={this.handleClick}
        handleSelection={this.handleSelection}
        selectable={this.selectable}
        selected={
          selectedItems
            ? selectedItems.findIndex(selectedItem => selectedItem.id === item.id) >= 0
            : stateSelectedItems.includes(item)
        }
        activeTileUrl={activeTileUrl}
        settings={this.settings}
        thumbnailSize={thumbnailSize}
        scrollSpeed={scrollSpeed}
        toprightoverlay={toprightoverlay}
        bottomleftoverlay={bottomleftoverlay}
      />
    );
  };

  renderGroup = group => {
    const { activeTileUrl } = this.state;
    return (
      <React.Fragment key={group.date}>
        <GroupHeader key={group.date} settings={this.settings} group={group} activeTileUrl={activeTileUrl} />
        {group.items.map(item => this.renderTile(item))}
      </React.Fragment>
    );
  };

  renderFlat = item => this.renderTile(item);

  render() {
    const { renderedItems } = this.state;
    return (
      <div className={styles.output} ref={this.containerRef}>
        {renderedItems.map(item => {
          if (this.settings.groupByDate) {
            return this.renderGroup(item);
          }
          return this.renderFlat(item);
        })}
      </div>
    );
  }
}

Pig.defaultProps = {
  useLqip: true,
  primaryImageBufferHeight: 2500,
  secondaryImageBufferHeight: 100,
  expandedSize: 1000,
  thumbnailSize: 20, // Height in px. Keeping it low seeing as it gets blurred anyway with a css filter
  // settings specific to groups
  groupByDate: false,
  breakpoint: 800,
  groupGapSm: 50,
  groupGapLg: 50,
  gridGap: 8,
  bgColor: "#fff",
  getUrl: null,
  sortByDate: false,
  sortFunc: null,
  handleClick: null,
  selectable: false,
  handleSelection: null,
  numberOfItems: null,
  scaleOfImages: null,
  updateGroups: null,
  updateItems: null,
  selectedItems: null,
  toprightoverlay: null,
  bottomleftoverlay: null,
};

Pig.propTypes = {
  imageData: PropTypes.arrayOf(PropTypes.shape({})).isRequired,
  useLqip: PropTypes.bool,
  gridGap: PropTypes.number,
  getUrl: PropTypes.func,
  primaryImageBufferHeight: PropTypes.number,
  secondaryImageBufferHeight: PropTypes.number,
  sortByDate: PropTypes.bool,
  groupByDate: PropTypes.bool,
  groupGapSm: PropTypes.number,
  groupGapLg: PropTypes.number,
  breakpoint: PropTypes.number,
  sortFunc: PropTypes.func,
  expandedSize: PropTypes.number,
  thumbnailSize: PropTypes.number,
  bgColor: PropTypes.string,
  handleClick: PropTypes.func,
  selectable: PropTypes.bool,
  handleSelection: PropTypes.func,
  numberOfItems: PropTypes.number,
  scaleOfImages: PropTypes.number,
  updateGroups: PropTypes.func,
  updateItems: PropTypes.func,
  selectedItems: PropTypes.arrayOf(PropTypes.shape({})),
  toprightoverlay: PropTypes.shape({}),
  bottomleftoverlay: PropTypes.shape({}),
};
