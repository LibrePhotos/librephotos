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
  onImageLoad: () => void;
  enableZoom: boolean;
  isPublic: boolean;
};

export type LightBoxProps = {
  idx2hash: Array<{ id: string; image_hash: string }>;
  isPublic: boolean;
  onCloseRequest: () => void;
  onChangedIndex: (currentIndex?: number) => void;
  selectedImage: string;
};

export type ImageDimensions = {
  width: number;
  height: number;
};

export type MediaDisplayProps = {
  id: string | undefined;
  image_hash: string | undefined;
  isMainContent?: boolean;
  type: string;
  bind?: any;
  imageDimensions: ImageDimensions;
  setImageDimensions: (dimensions: ImageDimensions) => void;
  faceLocation: FaceLocationType;
  toggleZoom?: () => void;
  scale?: number;
  offset?: { x: number; y: number };
  handleDragStart: (event: React.DragEvent) => void;
  fullHeight?: boolean;
  playing?: boolean;
  onEnded?: () => void;
};

export type LightboxControlsProps = {
  photoDetail: Photo | undefined;
  isPhotoDetailsLoading: boolean;
  lightboxSidebarShow: boolean;
  setLightBoxSidebarShow: React.Dispatch<React.SetStateAction<boolean>>;
  isPublic: boolean;
  enableZoom: boolean;
  type: string;
  isZoomed: boolean;
  toggleZoom: () => void;
  onCloseRequest: () => void;
  playing: boolean;
  setPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  isSlideshowActive: boolean;
  toggleSlideshow: () => void;
  slideshowInterval: number;
  setSlideshowInterval: (interval: number) => void;
  slideshowProgress: number; // 0-100 percentage for progress ring
};

export type ThumbnailNavigationProps = {
  prevSrc: string | null;
  prevSrcHash: string | null;
  mainSrc: string;
  mainSrcHash: string;
  nextSrc: string | null;
  nextSrcHash: string | null;
  onMovePrevRequest: () => void;
  onMoveNextRequest: () => void;
  containerWidth?: string;
};

export type SidebarProps = {
  id: string;
  closeSidepanel: () => void;
  isPublic: boolean;
  setFaceLocation: (location: FaceLocationType) => void;
};

export type FaceOverlayProps = {
  faceLocation: FaceLocationType;
  imageDimensions: ImageDimensions;
};
