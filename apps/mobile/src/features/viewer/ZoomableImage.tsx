import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import {
  Image,
  type ImageErrorEventData,
  type ImageLoadEventData,
  type ImageProgressEventData,
  type ImageSource,
} from "expo-image";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

const MAX_SCALE = 6;
const DOUBLE_TAP_SCALE = 2.5;

/**
 * A pinch-and-double-tap zoomable photo for the viewer pager (doc 05: "Swipe
 * pager, zoom, video" — zoom was missing from the viewer entirely).
 *
 * Two things are deliberate:
 *
 *  - **Panning is enabled only while zoomed in.** An always-on pan gesture
 *    would swallow the horizontal swipe that turns the page. The shared scale
 *    drives a `zoomed` state flag via `runOnJS`, and `Gesture.Pan().enabled()`
 *    reacts to it, so at 1x the pager owns horizontal movement again.
 *  - **The single tap stays a plain `Pressable`**, not a tap gesture. It is the
 *    accessible, testable path (RNTL can press it), and it composes fine with
 *    the pinch/pan gestures wrapped around it.
 */
export function ZoomableImage({
  source,
  placeholder,
  width,
  height,
  onTap,
  overlay,
  onZoomChange,
  onProgress,
  onLoad,
  onError,
  testID,
}: {
  source: ImageSource;
  /**
   * The grid tile the user just tapped, if it has one. expo-image already has
   * it decoded from the grid, so it paints on the first frame while the
   * full-size source is still coming off disk or the network — the difference
   * between "instant" and "a beat of black".
   */
  placeholder?: ImageSource;
  width: number;
  height: number;
  onTap?: () => void;
  /**
   * Decoration drawn in the image's own coordinate space (the face box). It
   * lives inside the transformed container so it tracks pinch and pan instead of
   * drifting off the face the moment the user zooms in.
   */
  overlay?: ReactNode;
  /** Zoomed in (pinch or double tap) or back at 1x; the viewer loads the original on the first zoom. */
  onZoomChange?: (zoomed: boolean) => void;
  /** expo-image's load events for `source`, for the resolution chip. */
  onProgress?: (event: ImageProgressEventData) => void;
  onLoad?: (event: ImageLoadEventData) => void;
  onError?: (event: ImageErrorEventData) => void;
  testID?: string;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const [zoomed, setZoomed] = useState(false);
  const updateZoomed = (next: boolean) => {
    setZoomed(next);
    onZoomChange?.(next);
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(1, savedScale.value * e.scale));
    })
    .onEnd(() => {
      if (scale.value <= 1.01) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedX.value = 0;
        savedY.value = 0;
        runOnJS(updateZoomed)(false);
        return;
      }
      savedScale.value = scale.value;
      runOnJS(updateZoomed)(true);
    });

  const pan = Gesture.Pan()
    .enabled(zoomed)
    .onUpdate((e) => {
      translateX.value = savedX.value + e.translationX;
      translateY.value = savedY.value + e.translationY;
    })
    .onEnd(() => {
      savedX.value = translateX.value;
      savedY.value = translateY.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1.01) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedX.value = 0;
        savedY.value = 0;
        runOnJS(updateZoomed)(false);
        return;
      }
      scale.value = withTiming(DOUBLE_TAP_SCALE);
      savedScale.value = DOUBLE_TAP_SCALE;
      runOnJS(updateZoomed)(true);
    });

  const gesture = Gesture.Simultaneous(pinch, pan, doubleTap);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[{ width, height, alignItems: "center", justifyContent: "center" }, animatedStyle]}
      >
        <Pressable onPress={onTap} style={{ width, height }}>
          <Image
            testID={testID}
            style={{ width, height }}
            source={source}
            placeholder={placeholder}
            placeholderContentFit="contain"
            contentFit="contain"
            cachePolicy="disk"
            transition={150}
            onProgress={onProgress}
            onLoad={onLoad}
            onError={onError}
          />
          {overlay ? (
            <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width, height }}>
              {overlay}
            </View>
          ) : null}
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}
