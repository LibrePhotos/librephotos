import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useTheme } from "@/theme";

/**
 * The detents a sheet can rest at (doc 07 §1.1).
 *
 * `peek` is the "what am I looking at" height — enough for a header without
 * covering the subject of the photo; `full` is the scrollable everything.
 */
export type SheetDetent = "hidden" | "peek" | "full";

export const DETENT_ORDER: SheetDetent[] = ["hidden", "peek", "full"];

/** Fractions of the window height. `hidden` is implied (offset === height). */
const PEEK_FRACTION = 0.34;
const FULL_FRACTION = 0.88;

/** Beyond this velocity a flick overshoots to the next detent (px/s). */
const FLICK_VELOCITY = 700;

export type SheetGeometry = {
  /** Rendered height of the sheet container. */
  height: number;
  /** translateY for each detent — larger means further off-screen. */
  offsets: Record<SheetDetent, number>;
};

/**
 * Pure detent geometry, so the snapping rules are unit-testable without a
 * gesture system or a renderer.
 */
export function sheetGeometry(windowHeight: number): SheetGeometry {
  const height = Math.round(windowHeight * FULL_FRACTION);
  const peek = Math.round(windowHeight * PEEK_FRACTION);
  return {
    height,
    offsets: { hidden: height, peek: height - peek, full: 0 },
  };
}

/**
 * Which detent a drag should land on: the nearest one to where the sheet is,
 * except that a fast flick carries it one detent further in the flick's
 * direction. Velocity is px/s (what the pan gesture reports).
 */
export function snapTarget(
  geometry: SheetGeometry,
  translateY: number,
  velocityY: number
): SheetDetent {
  const nearest = DETENT_ORDER.reduce((best, detent) =>
    Math.abs(geometry.offsets[detent] - translateY) < Math.abs(geometry.offsets[best] - translateY)
      ? detent
      : best
  );
  if (Math.abs(velocityY) < FLICK_VELOCITY) return nearest;
  // Positive velocity = the finger is moving *down* the screen = closing, and
  // `hidden` is index 0, so a downward flick steps towards the front of the
  // order, not the back.
  const step = velocityY > 0 ? -1 : 1;
  const index = DETENT_ORDER.indexOf(nearest) + step;
  return DETENT_ORDER[Math.min(DETENT_ORDER.length - 1, Math.max(0, index))];
}

/**
 * A draggable bottom sheet with three detents.
 *
 * Built on the `react-native-gesture-handler` + `react-native-reanimated` the
 * app already depends on rather than pulling in a sheet library, because the
 * hoisting rules in README "Dependency constraints" make every new package a
 * real risk and this is ~120 lines of gesture math.
 *
 * Two deliberate choices:
 *
 *  - **Only the grabber pans.** If the whole sheet owned a pan gesture it would
 *    fight the ScrollView inside it, and the losing gesture is always the one
 *    the user meant. The grabber is a wide, tall (44pt) target for exactly that
 *    reason, and tapping it cycles detents for anyone who cannot drag.
 *  - **The sheet never covers the whole screen and never takes a backdrop.**
 *    The photo underneath stays swipeable while the sheet is open — the pager
 *    is a sibling, not a parent (doc 07 §1.1).
 */
export function BottomSheet({
  detent,
  onDetentChange,
  children,
  testID,
  accessibilityLabel,
}: {
  detent: SheetDetent;
  onDetentChange: (detent: SheetDetent) => void;
  children: ReactNode;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const geometry = useMemo(() => sheetGeometry(windowHeight), [windowHeight]);

  const translateY = useSharedValue(geometry.offsets[detent]);
  const dragStart = useSharedValue(0);

  useEffect(() => {
    translateY.value = withTiming(geometry.offsets[detent], { duration: 220 });
  }, [detent, geometry, translateY]);

  const settle = useCallback(
    (next: SheetDetent) => {
      onDetentChange(next);
    },
    [onDetentChange]
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          dragStart.value = translateY.value;
        })
        .onUpdate((event) => {
          const next = dragStart.value + event.translationY;
          // Rubber-band past `full` so an over-drag feels bounded, not stuck.
          translateY.value = next < 0 ? next / 3 : Math.min(next, geometry.offsets.hidden);
        })
        .onEnd((event) => {
          const target = snapTarget(geometry, translateY.value, event.velocityY);
          translateY.value = withTiming(geometry.offsets[target], { duration: 200 });
          runOnJS(settle)(target);
        }),
    [dragStart, geometry, settle, translateY]
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  /** Tap the grabber: peek → full → hidden. The no-drag path to every detent. */
  const cycle = useCallback(() => {
    settle(detent === "full" ? "hidden" : detent === "peek" ? "full" : "peek");
  }, [detent, settle]);

  return (
    <Animated.View
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      pointerEvents={detent === "hidden" ? "none" : "auto"}
      style={[
        {
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: geometry.height,
          backgroundColor: theme.card,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          paddingBottom: insets.bottom,
          // Lifts the sheet off an arbitrary photo without a full backdrop.
          shadowColor: "#000",
          shadowOpacity: 0.3,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: -4 },
          elevation: 16,
        },
        animatedStyle,
      ]}
    >
      <GestureDetector gesture={pan}>
        <View>
          <Pressable
            testID={testID ? `${testID}-grabber` : undefined}
            onPress={cycle}
            accessibilityRole="button"
            // 44pt of grabbable height around a 4pt visual bar.
            style={{ height: 44, alignItems: "center", justifyContent: "center" }}
          >
            <View
              style={{
                width: 40,
                height: 4,
                borderRadius: 2,
                backgroundColor: theme.border,
              }}
            />
          </Pressable>
        </View>
      </GestureDetector>
      {/* Children are mounted only while the sheet is reachable. The container
          is always mounted (it owns the animation), but a hidden sheet's
          contents are a full metadata tree — including map tiles and a
          thumbnail row — that nobody can see. */}
      <View style={{ flex: 1 }}>{detent === "hidden" ? null : children}</View>
    </Animated.View>
  );
}
