import { ActionIcon, Rating, Tooltip } from "@mantine/core";
import { IconStar as Star, IconStarFilled as StarFilled } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import { FAVORITE_COLOR, ICON_SIZE } from "../../uiConstants";
import { MAX_RATING } from "../../util/rating";
import classes from "./LightboxRating.module.css";
import type { PhotoActions } from "./usePhotoActions";

function starLabel(t: TFunction, value: number) {
  return value === 0 ? t("lightbox.toolbar.clearRating") : t("lightbox.toolbar.rateStars", { count: value });
}

/**
 * The favorite toggle's two stars, so both styles look alike in either colour
 * scheme (Mantine's empty star is near-white on the black lightbox in the light
 * scheme). `size` is the symbol size in px.
 */
export function starSymbols(size: number, emptyColor: string) {
  return {
    emptySymbol: <Star size={size} color={emptyColor} className={classes.symbol} />,
    fullSymbol: <StarFilled size={size} color={FAVORITE_COLOR} className={classes.symbol} />,
    size,
  };
}

const LIGHTBOX_STARS = starSymbols(ICON_SIZE.lightbox, "var(--app-scrim-white-60)");

type StarRowProps = Readonly<{
  rating: number;
  readOnly: boolean;
  onRate: (rating: number) => void;
  symbols?: ReturnType<typeof starSymbols>;
  /** Shown on hover; the lightbox names the 0-5 keys. */
  tooltip?: string;
}>;

/**
 * Five stars: click to rate, click the current value again to clear it. A
 * photo someone shared with you shows its owner's rating, read-only.
 */
export function StarRow({ rating, readOnly, onRate, symbols = LIGHTBOX_STARS, tooltip }: StarRowProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  if (readOnly) {
    return (
      <Rating
        value={rating}
        count={MAX_RATING}
        {...symbols}
        readOnly
        role="img"
        aria-label={t("lightbox.toolbar.ratedStars", { rating })}
      />
    );
  }
  const row = (
    <Rating
      ref={ref}
      value={rating}
      count={MAX_RATING}
      {...symbols}
      allowClear
      role="radiogroup"
      aria-label={t("lightbox.toolbar.rating")}
      getSymbolLabel={value => starLabel(t, value)}
      onChange={value => {
        onRate(value);
        // A focused star is a radio input, where the lightbox's shortcuts
        // (Escape, the arrows, 0-5) are ignored; hand focus back.
        ref.current?.closest<HTMLElement>(".mantine-Modal-body")?.focus();
      }}
    />
  );
  return tooltip ? (
    <Tooltip label={tooltip} position="bottom" withArrow>
      {row}
    </Tooltip>
  ) : (
    row
  );
}

/**
 * The lightbox's rating control (#2202): the favorite toggle (F) in favorite
 * mode, a 5-star row (keys 0-5) in stars mode. usePhotoActions makes each
 * mode ignore the other's shortcut, so stars mode never calls
 * /photosedit/favorite/, whose un-favorite sets the rating to 0.
 */
export function LightboxRating({ actions }: Readonly<{ actions: PhotoActions }>) {
  const { t } = useTranslation();
  if (actions.ratesWithStars) {
    return (
      <StarRow
        rating={actions.rating}
        readOnly={!actions.canRate}
        onRate={actions.setRating}
        tooltip={t("lightbox.toolbar.rating")}
      />
    );
  }
  const label = actions.isFavorite ? t("lightbox.toolbar.removeFromFavorites") : t("lightbox.toolbar.addToFavorites");
  return (
    <Tooltip label={label} position="bottom" withArrow>
      <ActionIcon variant="subtle" color="gray" size={28} aria-label={label} onClick={actions.toggleFavorite}>
        {actions.isFavorite ? (
          <StarFilled size={ICON_SIZE.lightbox} color={FAVORITE_COLOR} />
        ) : (
          <Star size={ICON_SIZE.lightbox} />
        )}
      </ActionIcon>
    </Tooltip>
  );
}
