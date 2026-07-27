import { useCallback, useState } from "react";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useTranslation } from "react-i18next";
import type { People, Photo } from "@librephotos/api-client";
import { BottomSheet, type SheetDetent } from "@/components/BottomSheet";
import { useTheme } from "@/theme";
import { formatFullDate } from "@/lib/format";
import type { LocalAssetSummary, PhotoAlbumRow, PhotoSummary } from "@/db/queries/detail";
import { Note } from "./InfoPrimitives";
import {
  AlbumsSection,
  CameraInfoSection,
  CaptionSection,
  DeferredNote,
  FileInfoSection,
  LocationSection,
  PeopleSection,
  SceneSection,
  SimilarPhotosSection,
  TimestampRow,
} from "./InfoSections";

/**
 * The viewer's info surface: a draggable bottom sheet standing in for the web
 * lightbox's 400px sidebar, which has no phone-shaped equivalent (doc 07 §1.1).
 *
 * It is fed, never fetching: the screen owns the mirror queries, the
 * cache-then-network detail fetch and every mutation, so this composes cleanly
 * and each section is independently testable.
 *
 * Three data tiers show through in the props (doc 07 §1.3): `summary` is the
 * always-offline mirror row, `detail` is the cached-or-fetched full payload, and
 * `isOnline` gates the handful of controls that have no offline representation.
 */
export type PhotoInfoSheetProps = {
  detent: SheetDetent;
  onDetentChange: (detent: SheetDetent) => void;
  /** Mirror row — present for every photo the server knows about. */
  summary: PhotoSummary | null;
  /** Camera-roll row — present for every photo on this device. */
  local: LocalAssetSummary | null;
  detail: Photo | null;
  detailLoading: boolean;
  /** True when `detail` came from `remote_photo_detail` rather than the network. */
  fromCache: boolean;
  albums: PhotoAlbumRow[];
  serverAddress: string;
  headers: Record<string, string>;
  isOnline: boolean;
  mapsDisabled: boolean;
  onSaveCaption: (caption: string) => void;
  onEditTimestamp: () => void;
  onAddToAlbum: () => void;
  onRemoveFromAlbum: (album: PhotoAlbumRow) => void;
  onOpenAlbum: (album: PhotoAlbumRow) => void;
  onRenamePerson: (person: People) => void;
  onOpenPerson: (name: string) => void;
  onReviewFaces: () => void;
  onHighlightFace: (faceId: number | null) => void;
  highlightedFace: number | null;
  onSearch: (term: string) => void;
  onOpenPhoto: (imageHash: string) => void;
};

export function PhotoInfoSheet(props: PhotoInfoSheetProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [contentWidth, setContentWidth] = useState(width - 32);

  const onLayout = useCallback(
    (event: { nativeEvent: { layout: { width: number } } }) => {
      const next = event.nativeEvent.layout.width;
      if (next > 0 && Math.abs(next - contentWidth) > 1) setContentWidth(next);
    },
    [contentWidth]
  );

  /**
   * A server record is what every section below the header needs. Without one
   * the photo is camera-roll-only: it has no EXIF, no people and no albums *yet*
   * — a fact worth stating, rather than a screen of empty sections that reads as
   * "this photo has no metadata" (doc 07 §1.4).
   */
  const isLocalOnly = props.summary === null;
  /** Tier B is only honest once the payload has actually been seen. */
  const hasDetail = props.detail !== null;

  const timestamp = props.summary?.timestamp ?? props.local?.created_at ?? null;
  const placeName = props.summary?.search_location ?? props.detail?.search_location ?? null;
  const latitude = props.summary?.latitude ?? props.detail?.exif_gps_lat ?? null;
  const longitude = props.summary?.longitude ?? props.detail?.exif_gps_lon ?? null;

  return (
    <BottomSheet
      testID="viewer-detail-sheet"
      accessibilityLabel={t("viewer.details")}
      detent={props.detent}
      onDetentChange={props.onDetentChange}
    >
      <ScrollView
        testID="viewer-detail-scroll"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        onLayout={onLayout}
      >
        {/* ---- header: identity, always available ---- */}
        <View style={{ gap: 8, paddingBottom: 12 }}>
          <TimestampRow
            timestamp={timestamp}
            locale={i18n.language}
            isOnline={props.isOnline && !isLocalOnly}
            onEdit={props.onEditTimestamp}
          />
          {placeName ? (
            <Text testID="viewer-header-place" style={{ color: theme.muted, fontSize: 13 }}>
              {placeName}
            </Text>
          ) : null}
          {props.fromCache ? (
            <Note testID="viewer-from-cache" tone="offline" text={t("viewer.cachedDetails")} />
          ) : null}
          {props.detailLoading ? (
            <Note testID="viewer-detail-loading" text={t("viewer.loadingDetails")} />
          ) : null}
        </View>

        {isLocalOnly ? (
          <View
            testID="viewer-local-only-block"
            style={{
              borderTopWidth: 1,
              borderTopColor: theme.border,
              paddingTop: 14,
              gap: 8,
            }}
          >
            <Text style={{ color: theme.text, fontWeight: "700", fontSize: 15 }}>
              {t("viewer.localOnlyTitle")}
            </Text>
            <Note testID="viewer-local-only" text={t("viewer.localOnly")} />
            {props.local?.created_at ? (
              <Note
                testID="viewer-local-created"
                text={`${t("viewer.date")}: ${formatFullDate(props.local.created_at, { locale: i18n.language })}`}
              />
            ) : null}
          </View>
        ) : (
          <>
            <CaptionSection
              detail={props.detail}
              photoKey={props.summary?.image_hash ?? null}
              editable={!isLocalOnly}
              onSave={props.onSaveCaption}
            />
            <PeopleSection
              people={props.detail?.people ?? null}
              serverAddress={props.serverAddress}
              headers={props.headers}
              highlighted={props.highlightedFace}
              onHighlight={props.onHighlightFace}
              onOpenPerson={props.onOpenPerson}
              onRename={props.onRenamePerson}
              onReviewFaces={props.onReviewFaces}
              isCached={hasDetail}
            />
            <LocationSection
              placeName={placeName}
              latitude={latitude}
              longitude={longitude}
              contentWidth={contentWidth}
              mapsDisabled={props.mapsDisabled}
            />
            <AlbumsSection
              albums={props.albums}
              onOpenAlbum={props.onOpenAlbum}
              onAddToAlbum={props.onAddToAlbum}
              onRemoveFromAlbum={props.onRemoveFromAlbum}
            />
            <SceneSection detail={props.detail} onSearch={props.onSearch} />
            <FileInfoSection detail={props.detail} isCached={hasDetail} />
            <CameraInfoSection detail={props.detail} isCached={hasDetail} />
            <SimilarPhotosSection
              detail={props.detail}
              serverAddress={props.serverAddress}
              headers={props.headers}
              onOpen={props.onOpenPhoto}
              isCached={hasDetail}
            />
            <DeferredNote />
          </>
        )}
      </ScrollView>
    </BottomSheet>
  );
}
