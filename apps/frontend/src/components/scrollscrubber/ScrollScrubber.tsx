/* eslint-disable react-hooks/exhaustive-deps */
import { Badge, Box, Group } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import React, { useCallback, useEffect, useLayoutEffect, useState } from "react";
import _ from "lodash";
import type { MouseEvent, ReactNode } from "react";
import { ScrollerType } from "./ScrollScrubberTypes.zod";
import type { IScrollerData, IScrollerPosition, IScrollerType } from "./ScrollScrubberTypes.zod";
import "./ScrollScrubber.css"

type Props = {
  type: IScrollerType, // Type of scroller marks to display
  scrollPositions: IScrollerData[], // Array of positions to show on the scroller (label and Y position on target scrollable area)
  targetHeight: number, // Height of the target scrollable area 
  currentTargetY: number, // current scroll position off target scrollable area
  scrollToY: (number) => void, // Callback function that scrolls to a given Y position on target element
  children: ReactNode | null, // Target element must be one of the children nodes
};

export function ScrollScrubber({ type, scrollPositions, targetHeight, currentTargetY, scrollToY, children }: Props) {
  // ref and size of scrollscrubber
  const { ref, height } = useElementSize();
  const [scrollerWidth, setScrollerWidth] = useState(26);
  const [scrollerIsVisible, setScrollerIsVisible] = useState(false);
  const [positions, setPositions] = useState<IScrollerPosition[]>([]);
  const [markerPositions, setMarkerPositions] = useState<IScrollerPosition[]>([]);
  const [dragMarkerY, setDragMarkerY] = useState(0);
  const [currentScrollPosMarkerY, setCurrentScrollPosMarkerY] = useState(0);
  const [currentLabel, setCurrentLabel] = useState("");
  const [cursor, setCursor] = useState("auto");

  const targetYToScrollerY = (y: number): number => {
    if (targetHeight > 0)
      return (y * height / targetHeight);
    return NaN;
  };

  const scrollerYToTargetY = (y: number): number => {
    if (height > 0)
      return (y * targetHeight / height);
    return NaN;
  };

  const targetYToScrollerYPercentage = (y: number): number => {
    if (targetHeight > 0)
      return (y * 100 / targetHeight);
    return NaN;
  };

  const scrollerYToScrollerYPercentage = (y: number): number => {
    if (height > 0)
      return (y * 100 / height);
    return NaN;
  };

  const getLabelForScrollerY = (y: number): string => {   
    if (y < height / 2) {
      const pos = positions.find(item => (y < item.scrollerY));
      if (typeof pos !== "undefined")
      return pos.label
    } else {
      // Search array from the end
      for (let i = positions.length - 1; i >= 0; i -= 1) {
        if (y >= positions[i].scrollerY) {
          return positions[i].label;
        }
      }
    }
    return '';
  };

  const getAlphabetMarkers = useCallback((): IScrollerPosition[] => {
    const alphabet: IScrollerPosition[] = [];
    let currentLetter: string | null = null;
    positions.forEach(item => {
      let firstChar = _.deburr(item.label.charAt(0)).toUpperCase();
      if (firstChar === firstChar.toLowerCase()) {
        // firstChar is not a letter
        if (/^\d$/.test(firstChar)) {
          // firstChar is a number
          firstChar = "#"
        } else {
          // firstChar is not alphanumeric
          firstChar = ":-)"
        }
      }
      if ( firstChar !== currentLetter) {
        currentLetter = firstChar;
        // Only display letter if there is enough space with preivous letter
        if (alphabet.length < 1 || item.scrollerY - alphabet.slice(-1)[0].scrollerY > 15) {
          alphabet.push({
            label: currentLetter,
            targetY: item.targetY,
            scrollerY: item.scrollerY,
            scrollerYPercent: item.scrollerYPercent
          });
        }
      }
   });
   return alphabet;
  }, [positions])

  const getDateMarkers = useCallback((): IScrollerPosition[] => {
    console.log("getDateMarkers not implemented");
    return positions;
  }, [positions]);

  const getLabelsMarkers = useCallback((): IScrollerPosition[] => positions, [positions]);

  useEffect(() => {
    let markersType = type;
    if (positions.length < 10)
      markersType = ScrollerType.enum.labels;

    if (markersType === ScrollerType.enum.alphabet)
      setMarkerPositions(getAlphabetMarkers());
    else if (markersType === ScrollerType.enum.date)
      setMarkerPositions(getDateMarkers());
    else
      setMarkerPositions(getLabelsMarkers());
  }, [positions]);

  useLayoutEffect(() => {
    const newPositions: IScrollerPosition[] = [];
    if (scrollPositions.length > 0) {
      scrollPositions.forEach(item => {
        newPositions.push({
          label: item.label,
          targetY: item.targetY,
          scrollerY: targetYToScrollerY(item.targetY),
          scrollerYPercent: targetYToScrollerYPercentage(item.targetY)
        });
      });
      // Ensure positions are sorted by ascending targetY value
      newPositions.sort((a, b) => (a.targetY > b.targetY) ? 1 : -1);
    }
    setPositions(newPositions);   
  }, [scrollPositions]);

  const handleMouseOver = () => {
    setScrollerWidth(150);
    setScrollerIsVisible(true);
    setCurrentScrollPosMarkerY(targetYToScrollerY(currentTargetY));
  };

  const handleMouseOut = () => {
    setScrollerIsVisible(false);
    setScrollerWidth(26);
  };

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const distanceFromRight = rect.right - e.clientX;
    if (distanceFromRight < 40) {
      setCursor("pointer");
      setCurrentLabel(getLabelForScrollerY(mouseY));
    }
    else {
      setCursor("auto");
      setCurrentLabel('');
    }
    setDragMarkerY(mouseY);
  };

  const handleMouseClick = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const distanceFromRight = rect.right - e.clientX;
    if (distanceFromRight < 40) {
      scrollToY(scrollerYToTargetY(mouseY));
    }
  };

  const renderMarkers = useCallback(() => {
    if (!scrollerIsVisible || markerPositions.length === 0)
      return null;
    
    const halfMarkerHeightInPercent =  scrollerYToScrollerYPercentage(6);
    return markerPositions.map<ReactNode>(
        item =>
          <Badge
            key={item.label}
            className="scrollscrubber-marker"
            radius="md"
            variant="outline"
            size="sm"
            color="dark"
            style= {{ top: `${item.scrollerYPercent - halfMarkerHeightInPercent}%`, cursor: "pointer" }}
            onClick={() => {scrollToY(item.targetY)}}
          >
            {item.label}
          </Badge>
      ).reduce((prev: ReactNode, curr: ReactNode) => [prev, ' ', curr]);
  }, [markerPositions, scrollerIsVisible]);

  const renderMarkersLines = useCallback(() => {
    if (!scrollerIsVisible || markerPositions.length === 0)
      return null;

    const halfMarkerLineHeightInPercent =  scrollerYToScrollerYPercentage(2);      
    return markerPositions.map<ReactNode>(
        item =>
          <Box
            key={`line-${item.label}`}
            className="scrollscrubber-marker-line"
            sx={theme => ({
              backgroundColor: theme.colorScheme === "dark" ? theme.colors.gray[0] : theme.colors.dark[6]
            })}
            style= {{ top: `${item.scrollerYPercent + halfMarkerLineHeightInPercent}%` }}
          />
      ).reduce((prev: ReactNode, curr: ReactNode) => [prev, ' ', curr]);
  }, [markerPositions, scrollerIsVisible]);

  const renderGrabMarker = () => (
    <Group style={{
      position: "absolute",
      right: 0,
      top: dragMarkerY }}
    >
      {currentLabel !== '' && ( 
        <Badge
          radius="md"
          variant="outline"
          color="dark"
          size="lg"
          style={{
            position: "absolute",
            backgroundColor: "white",
            right: "25px" }}
        >
          {currentLabel}
        </Badge>
      )}
      <Box
        className="scrollscrubber-drag-position"
        sx={theme => ({
          backgroundColor: theme.colorScheme === "dark" ? theme.colors.dark[6] : theme.colors.gray[0],
          boxShadow: `0 0 0 4px ${theme.colorScheme === "dark"
          ? theme.colors.gray[0]
          : theme.colors.dark[6]}`
        })}
      />
    </Group>
  );

  const renderCurrentScrollPosMarker = () => (
    <Box
      className="scrollscrubber-current-position"
      sx={theme => ({
        backgroundColor: theme.colorScheme === "dark" ? theme.colors.dark[6] : theme.colors.gray[0],
        boxShadow: `0 0 0 4px ${theme.colors.green[6]}`
      })}
      style={{
        top: currentScrollPosMarkerY
      }}
    />
  );

  return (
    <div>
      {children}
      <Box
        ref={ref}
        className="scrollscrubber"
        style={{
          width: scrollerWidth,
          opacity: scrollerIsVisible ? 1 : 0,
          cursor: cursor
        }}
        onMouseOver={()=>handleMouseOver()}
        onMouseOut={()=>handleMouseOut()}
        onFocus={()=>handleMouseOver()}
        onBlur={()=>handleMouseOut()}
        onMouseMove={handleMouseMove}
        onClick={handleMouseClick}
      >  
        {renderMarkers()}
        {renderMarkersLines()}
        {renderGrabMarker()}
        {renderCurrentScrollPosMarker()}
      </Box>
    </div>
  );
}