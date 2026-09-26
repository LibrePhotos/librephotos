import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import type { People, Photo } from "@librephotos/api-client";
import { squareThumbnailUrl } from "@librephotos/api-client";
import { Icon } from "@/components/Icon";
import { useTheme } from "@/theme";
import { formatBytes, formatFullDate } from "@/lib/format";
import type { PhotoAlbumRow } from "@/db/queries/detail";
import {
  Chip,
  Disclosure,
  InfoRow,
  LinkButton,
  Note,
  OnlineOnlyButton,
  Section,
  chipRowStyle,
} from "./InfoPrimitives";
import {
  captureSummary,
  directoryFromPaths,
  filenameFromPaths,
  formatDigitalZoom,
  formatDimensions,
  formatFocalLength,
  formatMegapixels,
  formatSubjectDistance,
  probabilityColor,
  sceneLabels,
  suggestedCaption,
  userCaption,
} from "./exif";
import { MapPreview } from "./MapPreview";

/**
 * The individual sections of the viewer's info sheet (doc 07 §3).
 *
 * Each is presentational: it takes already-resolved data and handlers, so the
 * screen owns every query and every mutation and each section renders in
 * isolation under test. Every one of them has an explicit empty state and, where
 * the data is tier B, an explicit "not synced yet" state — a section is never
 * allowed to silently disappear (doc 07 §1.3).
 */

/* ---- caption ----------------------------------------------------------- */

export function CaptionSection({
  detail,
  photoKey,
  editable,
  onSave,
  testID = "viewer-caption-section",
}: {
  detail: Photo | null;
  /**
   * Stable identity of the photo being shown — the *mirror's* hash, not the
   * payload's. The editor resets on this and nothing else: keying it on the
   * detail payload would close the editor under the user's fingers the moment
   * the cache-then-network fetch settled and `saved` changed identity.
   */
  photoKey: string | null;
  editable: boolean;
  onSave: (caption: string) => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const saved = userCaption(detail?.captions_json) ?? "";
  const suggestion = suggestedCaption(detail?.captions_json);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(saved);

  // A new slide must not carry the previous photo's draft into its editor.
  useEffect(() => {
    setEditing(false);
    setDraft("");
  }, [photoKey]);

  return (
    <Section
      testID={testID}
      title={t("viewer.caption")}
      icon="edit"
      action={
        editable && !editing ? (
          <LinkButton
            testID="viewer-caption-edit"
            label={t("viewer.editCaption")}
            onPress={() => {
              setDraft(saved);
              setEditing(true);
            }}
          />
        ) : null
      }
    >
      {editing ? (
        <View style={{ gap: 8 }}>
          <TextInput
            testID="viewer-caption-input"
            value={draft}
            onChangeText={setDraft}
            multiline
            placeholder={t("mutations.captionPlaceholder")}
            placeholderTextColor={theme.muted}
            style={{
              color: theme.text,
              backgroundColor: theme.background,
              borderColor: theme.border,
              borderWidth: 1,
              borderRadius: 8,
              padding: 10,
              minHeight: 72,
              fontSize: 14,
            }}
          />
          {/* The model's own suggestion ships inside the cached payload, so it
              is offered offline — only *generating* a new one needs a server. */}
          {suggestion && suggestion !== draft ? (
            <Chip
              testID="viewer-caption-suggestion"
              label={suggestion}
              onPress={() => setDraft(suggestion)}
              leading={<Icon name="sparkle" size={14} color={theme.brand} />}
            />
          ) : null}
          <View style={{ flexDirection: "row", gap: 16 }}>
            <LinkButton
              testID="viewer-caption-save"
              label={t("common.save")}
              onPress={() => {
                setEditing(false);
                onSave(draft.trim());
              }}
            />
            <LinkButton
              testID="viewer-caption-cancel"
              label={t("common.cancel")}
              onPress={() => {
                setDraft(saved);
                setEditing(false);
              }}
            />
          </View>
        </View>
      ) : saved ? (
        <Text testID="viewer-caption-text" selectable style={{ color: theme.text, fontSize: 14 }}>
          {saved}
        </Text>
      ) : (
        <Note testID="viewer-caption-empty" text={t("viewer.noCaption")} />
      )}
    </Section>
  );
}

/* ---- scene labels ------------------------------------------------------ */

export function SceneSection({
  detail,
  onSearch,
  testID = "viewer-scene-section",
}: {
  detail: Photo | null;
  onSearch: (term: string) => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const labels = sceneLabels(detail?.captions_json);
  const empty =
    labels.attributes.length === 0 && labels.categories.length === 0 && labels.tags.length === 0;

  return (
    <Section testID={testID} title={t("viewer.scene")} icon="tags">
      {empty ? (
        <Note testID="viewer-scene-empty" text={t("viewer.noScene")} />
      ) : (
        <View style={{ gap: 10 }}>
          <LabelGroup title={t("viewer.tags")} labels={labels.tags} onSearch={onSearch} idPrefix="tag" />
          <LabelGroup
            title={t("viewer.attributes")}
            labels={labels.attributes}
            onSearch={onSearch}
            idPrefix="attribute"
          />
          <LabelGroup
            title={t("viewer.categories")}
            labels={labels.categories}
            onSearch={onSearch}
            idPrefix="category"
          />
        </View>
      )}
    </Section>
  );
}

function LabelGroup({
  title,
  labels,
  onSearch,
  idPrefix,
}: {
  title: string;
  labels: string[];
  onSearch: (term: string) => void;
  idPrefix: string;
}) {
  const theme = useTheme();
  if (labels.length === 0) return null;
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: theme.muted, fontSize: 12, fontWeight: "600" }}>{title}</Text>
      <View style={chipRowStyle()}>
        {labels.map((label) => (
          <Chip
            key={label}
            testID={`viewer-${idPrefix}-${label}`}
            label={label}
            onPress={() => onSearch(label)}
          />
        ))}
      </View>
    </View>
  );
}

/* ---- people ------------------------------------------------------------ */

export function PeopleSection({
  people,
  serverAddress,
  headers,
  highlighted,
  onHighlight,
  onOpenPerson,
  onRename,
  onReviewFaces,
  isCached,
  testID = "viewer-people-section",
}: {
  people: People[] | null;
  serverAddress: string;
  headers: Record<string, string>;
  highlighted: number | null;
  onHighlight: (faceId: number | null) => void;
  onOpenPerson: (name: string) => void;
  onRename: (person: People) => void;
  onReviewFaces: () => void;
  /** False means the detail payload has never been fetched for this photo. */
  isCached: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Section
      testID={testID}
      title={t("viewer.people")}
      icon="people"
      action={
        people && people.length > 0 ? (
          <LinkButton testID="viewer-people-review" label={t("viewer.reviewFaces")} onPress={onReviewFaces} />
        ) : null
      }
    >
      {!isCached ? (
        <Note testID="viewer-people-unsynced" tone="offline" text={t("viewer.notSyncedYet")} />
      ) : !people || people.length === 0 ? (
        <Note testID="viewer-people-empty" text={t("viewer.noPeople")} />
      ) : (
        <View style={{ gap: 8 }}>
          <View style={chipRowStyle()}>
            {people.map((person) => (
              <Chip
                key={`${person.face_id}-${person.name}`}
                testID={`viewer-person-${person.face_id}`}
                label={person.name}
                active={highlighted === person.face_id}
                onPress={() => onHighlight(highlighted === person.face_id ? null : person.face_id)}
                leading={
                  <View>
                    <Image
                      testID={`viewer-face-${person.face_id}`}
                      source={
                        person.face_url ? { uri: `${serverAddress}${person.face_url}`, headers } : undefined
                      }
                      style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: theme.border }}
                      contentFit="cover"
                      cachePolicy="disk"
                    />
                    {/* Same confidence thresholds as the web face dashboard. */}
                    <View
                      style={{
                        position: "absolute",
                        right: -1,
                        bottom: -1,
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: probabilityColor(person.probability),
                      }}
                    />
                  </View>
                }
              />
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
            {people.map((person) => (
              <View key={`actions-${person.face_id}`} style={{ flexDirection: "row", gap: 12 }}>
                <LinkButton
                  testID={`viewer-person-open-${person.face_id}`}
                  label={t("viewer.openPerson", { name: person.name })}
                  onPress={() => onOpenPerson(person.name)}
                />
                <LinkButton
                  testID={`viewer-person-rename-${person.face_id}`}
                  label={t("mutations.rename")}
                  onPress={() => onRename(person)}
                />
              </View>
            ))}
          </View>
        </View>
      )}
    </Section>
  );
}

/* ---- location ---------------------------------------------------------- */

export function LocationSection({
  placeName,
  latitude,
  longitude,
  contentWidth,
  mapsDisabled,
  testID = "viewer-location-section",
}: {
  placeName: string | null;
  latitude: number | null;
  longitude: number | null;
  contentWidth: number;
  mapsDisabled: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const hasCoords = typeof latitude === "number" && typeof longitude === "number";

  return (
    <Section testID={testID} title={t("viewer.location")} icon="location">
      {placeName ? (
        <Text testID="viewer-location-name" selectable style={{ color: theme.text, fontSize: 14 }}>
          {placeName}
        </Text>
      ) : (
        <Note testID="viewer-location-empty" text={t("viewer.noLocation")} />
      )}
      {hasCoords ? (
        <>
          <MapPreview
            testID="viewer-map"
            latitude={latitude as number}
            longitude={longitude as number}
            label={placeName}
            width={contentWidth}
            disabled={mapsDisabled}
          />
          <InfoRow
            testID="viewer-coordinates"
            label={t("viewer.coordinates")}
            value={`${(latitude as number).toFixed(5)}, ${(longitude as number).toFixed(5)}`}
          />
        </>
      ) : null}
    </Section>
  );
}

/* ---- albums ------------------------------------------------------------ */

export function AlbumsSection({
  albums,
  onOpenAlbum,
  onAddToAlbum,
  onRemoveFromAlbum,
  testID = "viewer-albums-section",
}: {
  albums: PhotoAlbumRow[];
  onOpenAlbum: (album: PhotoAlbumRow) => void;
  onAddToAlbum: () => void;
  onRemoveFromAlbum: (album: PhotoAlbumRow) => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Section
      testID={testID}
      title={t("viewer.albums")}
      icon="album"
      action={
        <LinkButton testID="viewer-album-add" label={t("selection.addToAlbum")} onPress={onAddToAlbum} />
      }
    >
      {albums.length === 0 ? (
        <Note testID="viewer-albums-empty" text={t("viewer.noAlbums")} />
      ) : (
        albums.map((album) => (
          <View
            key={`${album.kind}-${album.id}`}
            style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }}
          >
            <Pressable
              testID={`viewer-album-${album.kind}-${album.id}`}
              onPress={() => onOpenAlbum(album)}
              accessibilityRole="button"
              style={{ flex: 1, minHeight: 32, justifyContent: "center" }}
            >
              <Text numberOfLines={1} style={{ color: theme.text, fontSize: 14 }}>
                {album.title}
              </Text>
              <Text style={{ color: theme.muted, fontSize: 12 }}>
                {t("explore.photoCount", { count: album.photo_count })}
              </Text>
            </Pressable>
            {/* Auto (event) albums are generated by the server — there is no
                "remove" for them, so the control is absent, not disabled. */}
            {album.kind === "user" ? (
              <LinkButton
                testID={`viewer-album-remove-${album.id}`}
                label={t("mutations.remove")}
                onPress={() => onRemoveFromAlbum(album)}
              />
            ) : null}
          </View>
        ))
      )}
    </Section>
  );
}

/* ---- similar photos ---------------------------------------------------- */

export function SimilarPhotosSection({
  detail,
  serverAddress,
  headers,
  onOpen,
  isCached,
  testID = "viewer-similar-section",
}: {
  detail: Photo | null;
  serverAddress: string;
  headers: Record<string, string>;
  onOpen: (imageHash: string) => void;
  isCached: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const similar = (detail?.similar_photos ?? []).filter((p) => p.image_hash !== detail?.image_hash);

  return (
    <Section testID={testID} title={t("viewer.similarPhotos")} icon="similar">
      {!isCached ? (
        <Note testID="viewer-similar-unsynced" tone="offline" text={t("viewer.notSyncedYet")} />
      ) : similar.length === 0 ? (
        <Note testID="viewer-similar-empty" text={t("viewer.noSimilarPhotos")} />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {similar.slice(0, 30).map((photo) => (
            <Pressable
              key={photo.image_hash}
              testID={`viewer-similar-${photo.image_hash}`}
              onPress={() => onOpen(photo.image_hash)}
              accessibilityRole="button"
            >
              <Image
                source={{ uri: squareThumbnailUrl(serverAddress, photo.image_hash), headers }}
                style={{ width: 84, height: 84, borderRadius: 8, backgroundColor: theme.border }}
                contentFit="cover"
                cachePolicy="disk"
                transition={120}
              />
            </Pressable>
          ))}
        </ScrollView>
      )}
    </Section>
  );
}

/* ---- file + camera ----------------------------------------------------- */

export function FileInfoSection({
  detail,
  isCached,
  testID = "viewer-file-section",
}: {
  detail: Photo | null;
  isCached: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  const filename = filenameFromPaths(detail?.image_path);
  const directory = directoryFromPaths(detail?.image_path);
  const dimensions = formatDimensions(detail?.width, detail?.height);
  const megapixels = formatMegapixels(detail?.width, detail?.height);
  const size = detail?.size ? formatBytes(detail.size) : null;
  const anything = filename || dimensions || size;

  return (
    <Section testID={testID} title={t("viewer.fileInfo")} icon="file">
      {!isCached ? (
        <Note testID="viewer-file-unsynced" tone="offline" text={t("viewer.notSyncedYet")} />
      ) : !anything ? (
        <Note testID="viewer-file-empty" text={t("viewer.noFileInfo")} />
      ) : (
        <>
          <InfoRow
            testID="viewer-filename"
            label={t("viewer.filename")}
            value={filename ?? t("viewer.unknownFilename")}
          />
          <InfoRow
            testID="viewer-dimensions"
            label={t("viewer.dimensions")}
            value={dimensions && megapixels ? `${dimensions} · ${megapixels}` : dimensions}
          />
          <InfoRow testID="viewer-size" label={t("viewer.size")} value={size} />
          {directory ? (
            <Disclosure testID="viewer-file-more">
              <InfoRow label={t("viewer.filePath")} value={directory} />
            </Disclosure>
          ) : null}
        </>
      )}
    </Section>
  );
}

export function CameraInfoSection({
  detail,
  isCached,
  testID = "viewer-camera-section",
}: {
  detail: Photo | null;
  isCached: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const summary = captureSummary(detail ?? {});
  const extras = [
    formatSubjectDistance(detail?.subjectDistance),
    formatDigitalZoom(detail?.digitalZoomRatio),
    formatFocalLength(detail?.focalLength35Equivalent),
  ].filter((v): v is string => v !== null);

  return (
    <Section testID={testID} title={t("viewer.cameraInfo")} icon="camera">
      {!isCached ? (
        <Note testID="viewer-camera-unsynced" tone="offline" text={t("viewer.notSyncedYet")} />
      ) : !detail?.camera && !summary ? (
        <Note testID="viewer-camera-empty" text={t("viewer.noCameraInfo")} />
      ) : (
        <>
          {detail?.camera ? (
            <Text testID="viewer-camera-name" style={{ color: theme.text, fontWeight: "600", fontSize: 14 }}>
              {detail.camera}
            </Text>
          ) : null}
          <InfoRow testID="viewer-lens" label={t("viewer.lens")} value={detail?.lens} />
          <InfoRow testID="viewer-capture" label={t("viewer.capture")} value={summary} />
          {extras.length > 0 ? (
            <Disclosure testID="viewer-camera-more">
              <InfoRow
                label={t("viewer.subjectDistance")}
                value={formatSubjectDistance(detail?.subjectDistance)}
              />
              <InfoRow label={t("viewer.digitalZoom")} value={formatDigitalZoom(detail?.digitalZoomRatio)} />
              <InfoRow
                label={t("viewer.focalLength35")}
                value={formatFocalLength(detail?.focalLength35Equivalent)}
              />
            </Disclosure>
          ) : null}
        </>
      )}
    </Section>
  );
}

/* ---- timestamp --------------------------------------------------------- */

export function TimestampRow({
  timestamp,
  locale,
  isOnline,
  onEdit,
  testID = "viewer-timestamp",
}: {
  /** ms epoch, an ISO string, or null for "without timestamp". */
  timestamp: number | string | null;
  locale: string;
  isOnline: boolean;
  onEdit: () => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const label = formatFullDate(timestamp, { locale }) || t("viewer.withoutTimestamp");

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Icon name="calendar" size={16} color={theme.muted} />
      <Text testID={testID} style={{ color: theme.text, fontSize: 15, fontWeight: "600", flex: 1 }}>
        {label}
      </Text>
      <OnlineOnlyButton
        testID="viewer-timestamp-edit"
        label={t("viewer.editDateTime")}
        isOnline={isOnline}
        onPress={onEdit}
      />
    </View>
  );
}

/* ---- what mobile deliberately does not show ---------------------------- */

export function DeferredNote({ testID = "viewer-deferred-note" }: { testID?: string }) {
  const { t } = useTranslation();
  return (
    <View style={{ paddingVertical: 14 }}>
      <Note testID={testID} text={t("viewer.deferredNote")} />
    </View>
  );
}
