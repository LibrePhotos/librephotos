import type { Photo } from "../../actions/photosActions.types";

export type FaceLocationType = {
  top: number;
  bottom: number;
  left: number;
  right: number;
} | null;

export type ContentViewerProps = {
  mainSrc: string;
  nextSrc: string | null;
  prevSrc: string | null;
  type: string;
  onCloseRequest: () => void;
  onMovePrevRequest: () => void;
  onMoveNextRequest: () => void;
  onImageLoad: () => void;
  enableZoom: boolean;
  isPublic: boolean;
};

export type LightBoxProps = {
  idx2hash: Array<{ id: string }>;
  isPublic: boolean;
  onCloseRequest: () => void;
  onChangedIndex:  (currentIndex?: number) => void;
  selectedImage: string;
};

export type ImageDimensions = {
  width: number;
  height: number;
};

export type MediaDisplayProps = {
  id: string | undefined;
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
};

export type ThumbnailNavigationProps = {
  prevSrc: string | null;
  mainSrc: string;
  nextSrc: string | null;
  onMovePrevRequest: () => void;
  onMoveNextRequest: () => void;
  containerWidth?: string;
};

export type LightboxControlsProps = {
  photoDetail: Photo | undefined;
  lightboxSidebarShow: boolean;
  setLightBoxSidebarShow: React.Dispatch<React.SetStateAction<boolean>>;
  isPublic: boolean;
  enableZoom: boolean;
  type: string;
  isZoomed: boolean;
  toggleZoom: () => void;
  onCloseRequest: () => void;
};

export type FaceOverlayProps = {
  faceLocation: FaceLocationType;
  imageDimensions: ImageDimensions;
};