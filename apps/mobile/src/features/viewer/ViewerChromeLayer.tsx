import type { ViewerSlide } from "@/db/queries/detail";
import type { SlideSource } from "./originalSource";
import { ResolutionChip } from "./ResolutionChip";
import type { OriginalLoad } from "./useOriginalOnZoom";
import { ACTION_BAR_HEIGHT, ViewerActionBar, type ViewerActionBarProps } from "./ViewerActionBar";
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
  /** Thumbnail versions of photos rotated in this viewer, by image hash (cache busting). */
  thumbnailVersions: Readonly<Record<string, number>>;
  /** The bottom bar; null when the slide has nothing to act on. */
  actionBar: ViewerActionBarProps | null;
  /** The active slide's source and, when zoomed into its original, how its load is going. */
  zoom: { source: SlideSource | null; load: OriginalLoad; zoomed: boolean; onRetry: () => void };
  onClose: () => void;
  onToggleInfo: () => void;
  onSelectSlide: (index: number) => void;
};

/**
 * The viewer's chrome over the pager: the top bar, the filmstrip, the
 * resolution chip while zoomed in (#2743) and the action bar, stacked from the
 * bottom inset up.
 */
export function ViewerChromeLayer(props: Props) {
  const { chromeVisible, sheetOpen, actionBar, insets, slides, zoom } = props;
  if (!chromeVisible) return null;
  const filmstripBottom = actionBar ? ACTION_BAR_HEIGHT + insets.bottom : insets.bottom;
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
            versions={props.thumbnailVersions}
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
          {actionBar ? <ViewerActionBar {...actionBar} /> : null}
        </>
      )}
    </>
  );
}
