import type { Photo } from "../../api_client/photos/types";

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
  playing?: boolean;
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
};

export type FaceOverlayProps = {
  faceLocation: FaceLocationType;
  imageDimensions: ImageDimensions;
};