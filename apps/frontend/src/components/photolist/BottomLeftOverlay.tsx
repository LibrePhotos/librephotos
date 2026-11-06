import type { PigPhoto } from "@librephotos/api-client";
import { IconArchiveFilled as ArchiveFilled, IconStarFilled as StarFilled } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { isFavorite, ratesWithStars } from "../../util/rating";
import { TILE_GLYPH_SIZE, TileBadge, TileCorner } from "./TileBadge";

type Item = Pick<PigPhoto, "rating" | "archived">;

// In stars mode a rated tile shows its star count; an unrated one nothing.
function RatingBadge({ rating }: Readonly<{ rating: number }>) {
  const { t } = useTranslation();
  const label = t("phototile.rating", { rating });
  return (
    <TileBadge role="img" aria-label={label} title={label}>
      <StarFilled size={TILE_GLYPH_SIZE} aria-hidden="true" />
      {rating}
    </TileBadge>
  );
}

function RatingMark({ item }: Readonly<{ item: Item }>) {
  const { data: userDetails } = useCurrentUserSelfDetailsQuery();
  const { rating } = item;
  if (ratesWithStars(userDetails)) {
    return rating > 0 && <RatingBadge rating={rating} />;
  }
  // A plain white glyph like the other tile marks, not the lightbox's coloured star.
  return (
    isFavorite(rating, userDetails) && (
      <TileBadge>
        <StarFilled size={TILE_GLYPH_SIZE} color="white" />
      </TileBadge>
    )
  );
}

// An archived photo (#545) is off the timeline but still here: the mark says why it is missing there.
function ArchivedMark() {
  const { t } = useTranslation();
  const label = t("phototile.archived");
  return (
    <TileBadge role="img" aria-label={label} title={label}>
      <ArchiveFilled size={TILE_GLYPH_SIZE} aria-hidden="true" />
    </TileBadge>
  );
}

/** A tile's bottom-left corner: what the user said about the photo, its favourite star or rating, archived. */
export function BottomLeftOverlay({ item }: Readonly<{ item: Item }>) {
  return (
    <TileCorner position="bottomLeft">
      <RatingMark item={item} />
      {item.archived && <ArchivedMark />}
    </TileCorner>
  );
}
