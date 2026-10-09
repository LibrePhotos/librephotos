import type { Photo } from "../../api_client/photos/types";

export type FaceLocationType = {
  top: number;
  bottom: number;
  left: number;
  right: number;
} | null;

export type ContentViewerProps = {
  mainSrc: string;
  mainSrcHash: string;
  nextSrc: string | null;
  nextSrcHash: string | null;
  prevSrc: string | null;
  prevSrcHash: string | null;
  type: string;
  onCloseRequest: () => void;
  onMovePrevRequest: () => void;
  onMoveNextRequest: () => void;
  enableZoom: boolean;
  isPublic: boolean;
  publicAlbumSlug?: string;
  onPhotoSelect?: (photoId: string) => void;
  /** Start playing as a slideshow instead of waiting for the "s" hotkey. */
  startSlideshow?: boolean;
  /** The grid's entry for the photo shown. */
  gridItem?: LightboxItem;
};

/**
 * One entry of the list the lightbox steps through. `type` and `isTemp` come
 * from the grid's PigPhoto: a public page fetches no photo details, so the
 * grid is the only place that knows an item is a video, and `isTemp` marks a
 * placeholder for a page of the grid that has not loaded yet. `date` and
 * `location` are what the grid already shows a viewer who is not the owner,
 * for the details panel that has nothing else to show them.
 */
export type LightboxItem = {
  id: string;
  image_hash: string;
  type?: string;
  isTemp?: boolean;
  date?: string | null;
  location?: string;
};

export type LightBoxProps = {
  idx2hash: LightboxItem[];
  isPublic: boolean;
  publicAlbumSlug?: string;
  onCloseRequest: () => void;
  onChangedIndex: (currentIndex?: number) => void;
  selectedImage: string;
  /** Start playing as a slideshow instead of waiting for the "s" hotkey. */
  startSlideshow?: boolean;
};

export type ImageDimensions = {
  width: number;
  height: number;
};

export type LightboxControlsProps = {
  /** null when the details query had no hash to fetch. */
  photoDetail: Photo | null | undefined;
  isPhotoDetailsLoading: boolean;
  lightboxSidebarShow: boolean;
  setLightBoxSidebarShow: React.Dispatch<React.SetStateAction<boolean>>;
  isPublic: boolean;
  enableZoom: boolean;
  type: string;
  isZoomed: boolean;
  toggleZoom: () => void;
  onCloseRequest: () => void;
  onRotate: (angle: number) => void;
  playing: boolean;
  setPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  isSlideshowActive: boolean;
  toggleSlideshow: () => void;
  slideshowInterval: number;
  setSlideshowInterval: (interval: number) => void;
  slideshowProgress: number; // 0-100 percentage for progress ring
  // Live text (selectable OCR text overlay)
  hasOcrText: boolean;
  showOcrText: boolean;
  toggleOcrText: () => void;
  /** Copy the photo to the clipboard; absent when the page has no image clipboard or the item is a video. */
  onCopyToClipboard?: () => void;
  isCopyingToClipboard?: boolean;
  /** Called once the photo was moved to (or restored from) the trash. */
  onAfterTrashToggle?: () => void;
};

export type FaceOverlayProps = {
  faceLocation: FaceLocationType;
  imageDimensions: ImageDimensions;
};
