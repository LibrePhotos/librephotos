import { Loader, Title } from "@mantine/core";
import { IconCloud } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React, { useMemo, useState } from "react";
import useDimensions from "react-cool-dimensions";
import { useTranslation } from "react-i18next";
import { useFetchWordCloudQuery } from "../../api_client/stats/hooks";
import { EmptyState } from "../common/EmptyState";

type WordItem = {
  label: string;
  y: number;
  x?: number;
};

type PositionedWord = {
  label: string;
  fontSize: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
};

type Props = Readonly<{
  type: string;
  height: number;
}>;

const COLORS = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#a855f7", // purple
  "#d946ef", // fuchsia
  "#ec4899", // pink
  "#f43f5e", // rose
  "#0ea5e9", // sky
  "#14b8a6", // teal
  "#10b981", // emerald
  "#84cc16", // lime
];

// CJK ideographs, kana, Hangul and full-width forms are about 1em wide.
const WIDE_CHAR = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/;

function estimateTextWidth(text: string, fontSize: number): number {
  // Average Latin character width is roughly 0.55 of the font size for
  // sans-serif. Counting wide characters the same let Japanese place names
  // overlap their neighbours.
  let em = 0;
  for (const ch of text) {
    em += WIDE_CHAR.test(ch) ? 1 : 0.55;
  }
  return em * fontSize;
}

function rectanglesOverlap(
  r1: { x: number; y: number; width: number; height: number },
  r2: { x: number; y: number; width: number; height: number },
  padding = 2
): boolean {
  return !(
    r1.x + r1.width + padding < r2.x ||
    r2.x + r2.width + padding < r1.x ||
    r1.y + r1.height + padding < r2.y ||
    r2.y + r2.height + padding < r1.y
  );
}

function layoutWords(words: WordItem[], containerWidth: number, containerHeight: number): PositionedWord[] {
  if (!words.length || containerWidth <= 0 || containerHeight <= 0) {
    return [];
  }

  // Sort by weight descending - bigger words placed first
  const sortedWords = [...words].sort((a, b) => b.y - a.y);

  // Calculate min/max for normalization
  const values = sortedWords.map(w => w.y);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueRange = maxValue - minValue || 1;

  // Scale font sizes based on container and word count
  const scaleFactor = Math.min(containerWidth, containerHeight) / 400;
  const wordCountFactor = Math.max(0.5, 1 - sortedWords.length / 50);
  const minFontSize = Math.max(10, 12 * scaleFactor * wordCountFactor);
  const maxFontSize = Math.max(20, 42 * scaleFactor * wordCountFactor);

  const centerX = containerWidth / 2;
  const centerY = containerHeight / 2;
  const maxDiagonal = Math.sqrt(containerWidth ** 2 + containerHeight ** 2);

  const positionedWords: PositionedWord[] = [];

  sortedWords.forEach((word, i) => {
    // Normalize font size with logarithmic scaling for better distribution
    const normalizedValue = (word.y - minValue) / valueRange;
    const logScaled = normalizedValue ** 0.6; // Compress the range a bit
    // Shrink a word that would not fit the width at all: it was never placed,
    // so long names (often the top person) silently went missing.
    const fontSize = Math.min(
      minFontSize + logScaled * (maxFontSize - minFontSize),
      (containerWidth - 4) / estimateTextWidth(word.label, 1)
    );
    const width = estimateTextWidth(word.label, fontSize);
    const height = fontSize * 1.2;

    // Archimedean spiral placement algorithm
    let placed = false;
    const maxAttempts = 5000;
    const spiralStep = 0.15; // Angle increment per step
    const radiusGrowth = 4; // How fast the spiral expands

    let attempt = 0;
    while (attempt < maxAttempts && !placed) {
      attempt += 1;

      // Archimedean spiral: r = a + b*θ
      const angle = attempt * spiralStep;
      const radius = (radiusGrowth * angle) / (2 * Math.PI);

      // Stop if we've gone way beyond the container diagonal
      if (radius > maxDiagonal) break;

      // Adjust for rectangular containers - stretch spiral elliptically
      const aspectRatio = containerWidth / containerHeight;
      const x = centerX + radius * Math.cos(angle) * Math.sqrt(aspectRatio) - width / 2;
      const y = centerY + (radius * Math.sin(angle)) / Math.sqrt(aspectRatio) - height / 2;

      const candidate = { x, y, width, height };

      // Check bounds - keep words fully inside the container
      const inBounds = x >= 0 && x + width <= containerWidth && y >= 0 && y + height <= containerHeight;

      if (inBounds) {
        // Check collision with already placed words
        const hasCollision = positionedWords.some(placedWord => rectanglesOverlap(candidate, placedWord));

        if (!hasCollision) {
          positionedWords.push({
            label: word.label,
            fontSize,
            x,
            y,
            width,
            height,
            color: COLORS[i % COLORS.length],
          });
          placed = true;
        }
      }
    }
  });

  return positionedWords;
}

export function WordCloud(props: Props) {
  const { observe: observeChange, width } = useDimensions({
    onResize: ({ observe }) => {
      observe();
    },
    useBorderBoxSize: true,
    polyfill: ResizeObserver,
  });
  const { height, type } = props;
  const { data: wordCloud, isLoading } = useFetchWordCloudQuery();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [hoveredWord, setHoveredWord] = useState<string | null>(null);

  const title = () => {
    let result = t("people");
    if (type === "captions") {
      result = t("things");
    }
    if (type === "location") {
      result = t("places");
    }
    return result;
  };

  const handleWordClick = (label: string) => {
    navigate({ to: `/search/${encodeURIComponent(label)}` });
  };

  const words = useMemo(() => {
    if (!wordCloud) return [];

    if (type === "people") {
      return wordCloud.people;
    }
    if (type === "captions") {
      return wordCloud.captions;
    }
    if (type === "location") {
      return wordCloud.locations;
    }
    return [];
  }, [wordCloud, type]);

  // 0 until the ResizeObserver reports a width; a negative svg width is invalid.
  const chartWidth = Math.max(0, width - 50);
  const chartHeight = Math.max(0, height - 70);
  const positionedWords = useMemo(() => layoutWords(words, chartWidth, chartHeight), [words, chartWidth, chartHeight]);

  const hasData = words.length > 0;

  if (isLoading) {
    return <Loader />;
  }

  if (!wordCloud || !hasData) {
    return (
      <div ref={observeChange}>
        <Title order={3}>{title()}</Title>
        <EmptyState
          icon={<IconCloud size={40} />}
          title={t("emptystate.wordcloud.title")}
          description={t("emptystate.wordcloud.description")}
          actionLabel={t("emptystate.goToLibrary")}
          actionLink="/library"
        />
      </div>
    );
  }

  return (
    <div ref={observeChange}>
      <Title order={3}>{title()}</Title>
      {chartWidth > 0 && (
        <svg width={chartWidth} height={chartHeight} style={{ overflow: "visible" }} aria-label={title()}>
          {positionedWords.map((word, idx) => {
            const key = `${word.label}-${idx}`;
            const isHovered = hoveredWord === key;
            return (
              <text
                key={key}
                x={word.x + word.width / 2}
                y={word.y + word.height / 2}
                fontSize={word.fontSize}
                fontFamily="system-ui, -apple-system, sans-serif"
                fontWeight={word.fontSize > 30 ? 600 : 400}
                fill={word.color}
                textAnchor="middle"
                dominantBaseline="middle"
                onClick={() => handleWordClick(word.label)}
                onMouseEnter={() => setHoveredWord(`${word.label}-${idx}`)}
                onMouseLeave={() => setHoveredWord(null)}
                style={{
                  cursor: "pointer",
                  opacity: isHovered ? 0.7 : 1,
                  transform: isHovered ? "scale(1.05)" : "scale(1)",
                  transformOrigin: `${word.x + word.width / 2}px ${word.y + word.height / 2}px`,
                  transition: "opacity 0.15s ease, transform 0.15s ease",
                }}
              >
                {word.label}
              </text>
            );
          })}
        </svg>
      )}
    </div>
  );
}

export default WordCloud;
