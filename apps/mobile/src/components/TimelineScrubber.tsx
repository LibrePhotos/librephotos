import { useMemo, useState } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useTranslation } from "react-i18next";
import type { TimelineBucket } from "@/db/types";
import { useTheme } from "@/theme";
import {
  dayAtFraction,
  estimatedRows,
  fractionOfDay,
  monthLabel,
  scrubberIndex,
  spacedMarks,
  yearMarks,
} from "./scrubberMath";

const THUMB_HEIGHT = 44;
const TOUCH_WIDTH = 44;
/** Below this many list rows (about five screens) a fling is quicker. */
const MIN_ROWS = 30;

/**
 * The fast-scroll handle on the right edge of the timeline (the phone take on
 * the web's scroll scrubber). It spans the whole library, not just the rows
 * loaded so far: drag it and a month label and the year marks show where you
 * will land; let go and the timeline jumps there.
 */
export function TimelineScrubber({
  buckets,
  currentDay,
  visible,
  topInset,
  onScrubEnd,
}: {
  buckets: readonly TimelineBucket[];
  /** The day at the top of the screen, which positions the thumb. */
  currentDay: string | null;
  /** Shown while the timeline scrolls; always shown while dragging. */
  visible: boolean;
  topInset: number;
  onScrubEnd: (day: string) => void;
}) {
  const theme = useTheme();
  const { i18n } = useTranslation();
  const index = useMemo(() => scrubberIndex(buckets), [buckets]);
  const marks = useMemo(() => yearMarks(index), [index]);
  const [trackHeight, setTrackHeight] = useState(0);
  const [dragFraction, setDragFraction] = useState<number | null>(null);

  const travel = Math.max(trackHeight - THUMB_HEIGHT, 1);
  const fraction = dragFraction ?? fractionOfDay(index, currentDay);
  const dragging = dragFraction != null;

  const toFraction = (y: number) => Math.min(Math.max((y - THUMB_HEIGHT / 2) / travel, 0), 1);
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => setDragFraction(toFraction(e.y)))
    .onUpdate((e) => setDragFraction(toFraction(e.y)))
    .onEnd((e) => {
      const day = dayAtFraction(index, toFraction(e.y));
      if (day) onScrubEnd(day);
    })
    .onFinalize(() => setDragFraction(null));

  if (estimatedRows(buckets) < MIN_ROWS) return null;
  const draggingDay = dragging ? dayAtFraction(index, fraction) : null;

  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", right: 0, top: topInset, bottom: 8, width: dragging ? "100%" : TOUCH_WIDTH }}
    >
      {dragging
        ? spacedMarks(marks, travel).map((m) => (
            <Text
              key={m.year}
              style={{
                position: "absolute",
                right: TOUCH_WIDTH + 8,
                top: m.top + THUMB_HEIGHT / 2 - 8,
                color: theme.muted,
                fontSize: 12,
                fontWeight: "600",
              }}
            >
              {m.year}
            </Text>
          ))
        : null}
      <GestureDetector gesture={pan}>
        <View
          testID="timeline-scrubber"
          onLayout={(e: LayoutChangeEvent) => setTrackHeight(e.nativeEvent.layout.height)}
          style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: TOUCH_WIDTH, opacity: visible || dragging ? 1 : 0 }}
        >
          <View
            style={{
              position: "absolute",
              right: 4,
              top: fraction * travel,
              width: 30,
              height: THUMB_HEIGHT,
              borderRadius: 15,
              backgroundColor: theme.card,
              borderWidth: 1,
              borderColor: theme.border,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <View style={{ width: 12, height: 2, borderRadius: 1, backgroundColor: theme.muted, marginBottom: 4 }} />
            <View style={{ width: 12, height: 2, borderRadius: 1, backgroundColor: theme.muted }} />
          </View>
        </View>
      </GestureDetector>
      {draggingDay ? (
        <View
          testID="timeline-scrubber-label"
          pointerEvents="none"
          style={{
            position: "absolute",
            right: TOUCH_WIDTH + 52,
            top: fraction * travel + THUMB_HEIGHT / 2 - 18,
            backgroundColor: theme.text,
            borderRadius: 18,
            paddingHorizontal: 14,
            paddingVertical: 8,
          }}
        >
          <Text style={{ color: theme.background, fontWeight: "700" }}>{monthLabel(draggingDay, i18n.language)}</Text>
        </View>
      ) : null}
    </View>
  );
}
