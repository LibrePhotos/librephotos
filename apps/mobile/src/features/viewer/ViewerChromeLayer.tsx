import type { PhotoFlags, ViewerSlide } from "@/db/queries/detail";
import type { SlideSource } from "./originalSource";
import { ResolutionChip } from "./ResolutionChip";
import type { OriginalLoad } from "./useOriginalOnZoom";
import { ViewerActionBar } from "./ViewerActionBar";
import { FILMSTRIP_HEIGHT, ThumbnailStrip, ViewerTopBar } from "./ViewerChrome";

type Props = {
  /** Toggled by a tap on the photo. */
  chromeVisible: boolean;
  sheetOpen: boolean;
  title: string;
  subtitle: string | null;
  insets: { top: number; bottom: number };
  slides: ViewerSlide[];
  activeKey: string | undefined;
  serverAddress: string;
  headers: Record<string, string>;
  /** The mirror's flags; null for a camera-roll-only slide, which gets no action bar. */
  flags: PhotoFlags | null;
  isOnline: boolean;
  /** The active slide's source and, when zoomed into its original, how its load is going. */
  zoom: { source: SlideSource | null; load: OriginalLoad; zoomed: boolean; onRetry: () => void };
  onClose: () => void;
  onToggleInfo: () => void;
  onSelectSlide: (index: number) => void;
  actions: {
    onToggleFavorite: () => void;
    onToggleHide: () => void;
    onToggleTrash: () => void;
    onTogglePublic: () => void;
    onRate: (rating: number) => void;
  };
};

/**
 * The viewer's chrome over the pager: the top bar, the filmstrip, the
 * resolution chip while zoomed in (#2743) and the action bar, stacked from the
 * bottom inset up.
 */
export function ViewerChromeLayer(props: Props) {
  const { chromeVisible, sheetOpen, flags, insets, slides, zoom } = props;
  if (!chromeVisible) return null;
  const actionBarHeight = 96 + insets.bottom;
  const filmstripBottom = flags ? actionBarHeight : insets.bottom;
  const chipBottom = filmstripBottom + (slides.length > 1 ? FILMSTRIP_HEIGHT : 0) + 8;
  return (
    <>
      <ViewerTopBar
        title={props.title}
        subtitle={props.subtitle}
        topInset={insets.top}
        infoOpen={sheetOpen}
        onClose={props.onClose}
        onToggleInfo={props.onToggleInfo}
      />

      {sheetOpen ? null : (
        <>
          <ThumbnailStrip
            slides={slides}
            activeKey={props.activeKey}
            serverAddress={props.serverAddress}
            headers={props.headers}
            bottomOffset={filmstripBottom}
            onSelect={props.onSelectSlide}
          />
          {zoom.source ? (
            <ResolutionChip
              source={zoom.source}
              load={zoom.load}
              visible={zoom.zoomed}
              bottom={chipBottom}
              onRetry={zoom.onRetry}
            />
          ) : null}
          {/* No server row means no server-side flags to toggle — a bar full of
              no-ops is worse than no bar (doc 07 §1.4). */}
          {flags ? (
            <ViewerActionBar
              isFavorite={flags.is_favorite === 1}
              hidden={flags.hidden === 1}
              inTrashcan={flags.in_trashcan === 1}
              isPublic={flags.is_public === 1}
              rating={flags.rating}
              isOnline={props.isOnline}
              bottomInset={insets.bottom}
              {...props.actions}
            />
          ) : null}
        </>
      )}
    </>
  );
}
