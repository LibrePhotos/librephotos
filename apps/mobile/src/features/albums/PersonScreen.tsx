import { useCallback, useMemo, useState } from "react";
import { Alert, Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import {
  mediaHeaders,
  Photoset,
  squareThumbnailUrl,
  useDateAlbumPhotoChunksQuery,
  usePersonQuery,
} from "@librephotos/api-client";
import { MirrorGrid, type GridItem } from "@/components/MirrorGrid";
import { OnlinePhotoGrid } from "@/components/OnlinePhotoGrid";
import { OptionSheet, type SheetOption } from "@/components/OptionSheet";
import { ScreenHeader } from "@/components/ScreenHeader";
import { TextPromptModal } from "@/components/TextPromptModal";
import { Icon } from "@/components/Icon";
import { useReactiveQuery } from "@/db/provider";
import { people, personById } from "@/db/queries/people";
import { useGridSelection, type GridExtraAction } from "@/features/selection/useGridSelection";
import { useAccessToken } from "@/hooks/use-access-token";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { serverAddress } from "@/lib/apiClient";
import { goBackOr } from "@/lib/navigation";
import { pigPhotoToItem } from "@/lib/pigPhoto";
import { useMutations } from "@/mutations/useMutations";
import { useTheme } from "@/theme";
import { usePersonActions } from "./usePersonActions";

/**
 * iOS presents one modal at a time: a sheet that opens while the menu is still
 * sliding out never shows. The menu closes first, the next sheet opens after.
 */
const SHEET_SWAP_MS = 300;

type Sheet = "menu" | "merge" | "cover" | "rename" | null;

/**
 * One person's page (web `/album/persons/$id`): the name in the header, a face
 * avatar and photo count under it, then the person's photos with multi-select.
 *
 * The person (name, cover) comes from the mirror, so the header works offline;
 * which photos show the person is not mirrored (faces are online-only, doc 02),
 * so the grid is an online query read a chunk at a time, with the standard
 * offline state. Rename goes through the outbox; cover, merge, delete and
 * "Remove from person" talk to the server (usePersonActions).
 */
export function PersonScreen({ id }: { id: number }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const token = useAccessToken();
  const base = serverAddress();
  const headers = useMemo(() => mediaHeaders(token), [token]);
  const isOnline = useOnlineStatus();
  const mutations = useMutations();
  const actions = usePersonActions(id);

  const mirrored = useReactiveQuery((db) => personById(db, id), [id]);
  const others = useReactiveQuery((db) => people(db).filter((p) => p.id !== id), [id]);
  const fetched = usePersonQuery(id);
  const photos = useDateAlbumPhotoChunksQuery(Photoset.PERSON, { person: id });

  const name = mirrored?.name ?? fetched.data?.name ?? t("person.fallbackTitle");
  const coverHash = mirrored?.cover_photo_hash ?? fetched.data?.face_photo_url ?? null;
  const faceCount = mirrored?.face_count ?? fetched.data?.face_count ?? null;
  const photoCount = photos.data?.pages[0]?.groups.reduce((sum, day) => sum + day.numberOfItems, 0);

  const items = useMemo(
    () => photos.data?.pages.flatMap((page) => page.photos.map(pigPhotoToItem)) ?? [],
    [photos.data]
  );
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = photos;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const removeFromPerson = useMemo<GridExtraAction[]>(
    () => [
      {
        key: "remove-person",
        label: t("person.removeFromPerson"),
        icon: "faces",
        destructive: true,
        onlineOnly: true,
        run: ({ photoIds }, done) => {
          const count = photoIds.length;
          if (count === 0) return;
          Alert.alert(t("person.removeTitle", { count, name }), t("person.removeMessage", { count, name }), [
            { text: t("common.cancel"), style: "cancel" },
            {
              text: t("person.removeConfirm"),
              style: "destructive",
              onPress: () => {
                done();
                void actions.removePhotos(photoIds, name);
              },
            },
          ]);
        },
      },
    ],
    [t, name, actions]
  );
  const selection = useGridSelection({}, undefined, removeFromPerson);

  const [sheet, setSheet] = useState<Sheet>(null);
  /** Close the menu, then open `next` once it is gone. */
  const fromMenu = (next: Sheet | (() => void)) => () => {
    setSheet(null);
    setTimeout(() => (typeof next === "function" ? next() : setSheet(next)), SHEET_SWAP_MS);
  };

  const confirmDelete = () =>
    Alert.alert(t("person.deleteTitle", { name }), t("person.deleteMessage", { name }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("person.deleteConfirm"),
        style: "destructive",
        onPress: () => {
          void actions.deletePerson(name).then((ok) => {
            if (ok) goBackOr(router, "/albums/people/all");
          });
        },
      },
    ]);

  const confirmMerge = (target: { id: number; name: string }) => {
    const names = { source: name, target: target.name };
    const faces = faceCount ? `${t("person.mergeFaces", { count: faceCount, ...names })} ` : "";
    Alert.alert(t("person.mergeTitle", names), `${faces}${t("person.mergeRemoved", names)}`, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("person.mergeConfirm"),
        style: "destructive",
        onPress: () => {
          void actions.mergeInto(target).then((ok) => {
            if (ok) router.replace(`/albums/people/${target.id}`);
          });
        },
      },
    ]);
  };

  const offlineHint = isOnline ? undefined : t("offline.needsConnection");
  const menu: SheetOption[] = [
    { key: "rename", testID: "person-action-rename", icon: "edit", label: t("mutations.rename"), onPress: fromMenu("rename") },
    {
      key: "cover",
      testID: "person-action-cover",
      icon: "photo",
      label: t("person.setCover"),
      onPress: fromMenu("cover"),
      disabled: !isOnline || items.length === 0,
      hint: offlineHint,
    },
    {
      key: "merge",
      testID: "person-action-merge",
      icon: "merge",
      label: t("person.mergeInto"),
      onPress: fromMenu("merge"),
      disabled: !isOnline,
      hint: offlineHint,
    },
    {
      key: "delete",
      testID: "person-action-delete",
      icon: "trash",
      label: t("person.delete"),
      destructive: true,
      onPress: fromMenu(confirmDelete),
      disabled: !isOnline,
      hint: offlineHint,
    },
  ];

  const mergeTargets: SheetOption[] =
    others.length > 0
      ? others.map((p): SheetOption => {
          const target = { id: p.id, name: p.name ?? t("faces.unknown") };
          return {
            key: String(p.id),
            testID: `person-merge-${p.id}`,
            icon: "people",
            label: target.name,
            onPress: () => {
              setSheet(null);
              confirmMerge(target);
            },
          };
        })
      : [{ key: "none", testID: "person-merge-none", label: t("person.noOtherPeople"), disabled: true, onPress: () => {} }];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={["top"]}>
      <ScreenHeader
        title={name}
        fallback="/albums/people/all"
        testID="person-title"
        right={
          <Pressable
            testID="person-menu-button"
            accessibilityRole="button"
            accessibilityLabel={t("person.actions")}
            onPress={() => setSheet("menu")}
            hitSlop={8}
            style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}
          >
            <Icon name="more" size={24} color={theme.text} />
          </Pressable>
        }
      />
      <View
        testID="person-identity"
        style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 12 }}
      >
        <Image
          testID="person-avatar"
          style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: theme.card }}
          source={coverHash ? { uri: squareThumbnailUrl(base, coverHash), headers } : undefined}
          contentFit="cover"
          cachePolicy="disk"
        />
        <Text testID="person-count" style={{ color: theme.muted }}>
          {photoCount !== undefined
            ? t("explore.photoCount", { count: photoCount })
            : faceCount != null
              ? t("person.faceCount", { count: faceCount })
              : ""}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <OnlinePhotoGrid
          testID="person-grid"
          items={items}
          isLoading={photos.isLoading}
          isError={photos.isError}
          offlineMessage={t("person.offline")}
          emptyMessage={t("person.empty")}
          onEndReached={loadMore}
          selection={selection}
        />
      </View>
      {selection.overlay}

      <OptionSheet
        visible={sheet === "menu"}
        title={name}
        options={menu}
        onClose={() => setSheet(null)}
        testID="person-menu"
      />
      <OptionSheet
        visible={sheet === "merge"}
        title={t("person.mergeIntoTitle", { name })}
        options={mergeTargets}
        onClose={() => setSheet(null)}
        testID="person-merge-sheet"
      />
      <CoverPicker
        visible={sheet === "cover"}
        items={items}
        onPick={(item) => {
          setSheet(null);
          if (item.imageHash) void actions.setCover(item.imageHash);
        }}
        onEndReached={loadMore}
        onCancel={() => setSheet(null)}
      />
      <TextPromptModal
        visible={sheet === "rename"}
        title={t("mutations.renamePerson")}
        placeholder={t("mutations.personName")}
        initialValue={mirrored?.name ?? fetched.data?.name ?? ""}
        submitLabel={t("mutations.rename")}
        testID="person-rename-prompt"
        onSubmit={(value) => {
          setSheet(null);
          if (value && value !== name) mutations.renamePerson(id, value);
        }}
        onCancel={() => setSheet(null)}
      />
    </SafeAreaView>
  );
}

/** Pick the person's cover from their photos (web AlbumCoverPickerModal). */
function CoverPicker({
  visible,
  items,
  onPick,
  onEndReached,
  onCancel,
}: {
  visible: boolean;
  items: GridItem[];
  onPick: (item: GridItem) => void;
  onEndReached: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const token = useAccessToken();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable onPress={onCancel} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
        <Pressable
          testID="person-cover-picker"
          onPress={() => {}}
          style={{ backgroundColor: theme.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, height: "75%", paddingTop: 16 }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12 }}>
            <Text style={{ color: theme.text, fontWeight: "700", fontSize: 16 }}>{t("person.chooseCover")}</Text>
            <Pressable testID="person-cover-cancel" onPress={onCancel} hitSlop={8}>
              <Text style={{ color: theme.brand, fontWeight: "600" }}>{t("common.cancel")}</Text>
            </Pressable>
          </View>
          <MirrorGrid
            testID="person-cover-grid"
            items={items}
            serverAddress={serverAddress()}
            accessToken={token}
            onPressItem={onPick}
            onEndReached={onEndReached}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
