import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Image, type ImageSource } from "expo-image";
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
  width,
  height,
  onTap,
  overlay,
  testID,
}: {
  source: ImageSource;
  width: number;
  height: number;
  onTap?: () => void;
  /**
   * Decoration drawn in the image's own coordinate space (the face box). It
   * lives inside the transformed container so it tracks pinch and pan instead of
   * drifting off the face the moment the user zooms in.
   */
  overlay?: ReactNode;
  testID?: string;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const [zoomed, setZoomed] = useState(false);

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
        runOnJS(setZoomed)(false);
        return;
      }
      savedScale.value = scale.value;
      runOnJS(setZoomed)(true);
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
        runOnJS(setZoomed)(false);
        return;
      }
      scale.value = withTiming(DOUBLE_TAP_SCALE);
      savedScale.value = DOUBLE_TAP_SCALE;
      runOnJS(setZoomed)(true);
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
            contentFit="contain"
            cachePolicy="disk"
            transition={150}
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
