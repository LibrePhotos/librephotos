import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  endpoints,
  mediaHeaders,
  UNKNOWN_PERSON_NAME,
  useApiClient,
  useFacesQuery,
  type PersonFace,
} from "@librephotos/api-client";
import { useAccessToken } from "@/hooks/use-access-token";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { serverAddress } from "@/lib/apiClient";
import { useToastStore } from "@/stores/toasts";
import { faceImageUrl } from "./faceImage";
import { AssignNameSheet } from "./AssignNameSheet";
import { useTheme } from "@/theme";

type Tab = "inferred" | "unknown";

/**
 * Face tagging (Profile → Faces, online-only, doc 05). A touch-first review:
 *   - "Suggested": inferred faces with a suggested name — accept (labelFaces to
 *     the suggestion) or reject (label back to unknown) inline.
 *   - "Unknown": unlabeled faces — multi-select and assign a name (autocompletes
 *     the mirrored person list). "Rebuild people" queues re-clustering.
 */
export function FaceTaggingScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const client = useApiClient();
  const queryClient = useQueryClient();
  const token = useAccessToken();
  const base = serverAddress();
  const isOnline = useOnlineStatus();
  const headers = useMemo(() => mediaHeaders(token), [token]);
  const pushToast = useToastStore((s) => s.push);

  const [tab, setTab] = useState<Tab>("inferred");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [assigning, setAssigning] = useState(false);
  const [busy, setBusy] = useState(false);

  const inferred = useFacesQuery({ inferred: true }, isOnline && tab === "inferred");
  const unknown = useFacesQuery({ person: 0, inferred: false }, isOnline && tab === "unknown");
  const query = tab === "inferred" ? inferred : unknown;
  const faces = query.data?.results ?? [];

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["faces"] });

  const runLabel = async (faceIds: number[], name: string) => {
    setBusy(true);
    try {
      await endpoints.labelFaces(client, faceIds, name);
      pushToast({
        level: "info",
        message: name === UNKNOWN_PERSON_NAME ? t("faces.rejected") : t("faces.assigned", { name }),
      });
      setSelected(new Set());
      refresh();
    } catch {
      pushToast({ level: "error", message: t("common.error") });
    } finally {
      setBusy(false);
    }
  };

  const train = async () => {
    setBusy(true);
    try {
      await endpoints.trainFaces(client);
      pushToast({ level: "info", message: t("faces.trainQueued") });
    } catch {
      pushToast({ level: "error", message: t("common.error") });
    } finally {
      setBusy(false);
    }
  };

  const toggleSelect = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const switchTab = (next: Tab) => {
    setTab(next);
    setSelected(new Set());
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={["top"]}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 12, gap: 12 }}>
        <Pressable testID="faces-back" onPress={() => router.back()} hitSlop={8}>
          <Text style={{ color: theme.brand, fontSize: 16 }}>‹</Text>
        </Pressable>
        <Text style={{ fontSize: 22, fontWeight: "700", color: theme.text, flex: 1 }}>{t("faces.title")}</Text>
        <Pressable testID="faces-train" onPress={() => void train()} disabled={busy || !isOnline} hitSlop={8}>
          <Text style={{ color: isOnline ? theme.brand : theme.muted, fontWeight: "600" }}>{t("faces.train")}</Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: "row", backgroundColor: theme.card, borderRadius: 10, padding: 4, margin: 16 }}>
        {(["inferred", "unknown"] as const).map((key) => (
          <Pressable
            key={key}
            testID={`faces-tab-${key}`}
            onPress={() => switchTab(key)}
            style={{ flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: tab === key ? theme.background : "transparent", alignItems: "center" }}
          >
            <Text style={{ color: tab === key ? theme.text : theme.muted, fontWeight: "600" }}>
              {key === "inferred" ? t("faces.inferred") : t("faces.unknown")}
            </Text>
          </Pressable>
        ))}
      </View>

      {!isOnline ? (
        <View testID="faces-offline" style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
          <Text style={{ color: theme.muted }}>{t("faces.online")}</Text>
        </View>
      ) : query.isLoading ? (
        <View testID="faces-loading" style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={theme.brand} />
        </View>
      ) : (
        <FlatList
          testID="faces-grid"
          data={faces}
          numColumns={3}
          keyExtractor={(f) => String(f.id)}
          contentContainerStyle={{ padding: 8 }}
          ListEmptyComponent={
            <View testID="faces-empty" style={{ padding: 32, alignItems: "center" }}>
              <Text style={{ color: theme.muted }}>
                {tab === "inferred" ? t("faces.noInferred") : t("faces.noUnknown")}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <FaceCard
              face={item}
              tab={tab}
              base={base}
              headers={headers}
              theme={theme}
              busy={busy}
              selected={selected.has(item.id)}
              onToggle={() => toggleSelect(item.id)}
              onAccept={() => item.person_name && void runLabel([item.id], item.person_name)}
              onReject={() => void runLabel([item.id], UNKNOWN_PERSON_NAME)}
            />
          )}
        />
      )}

      {tab === "unknown" && selected.size > 0 ? (
        <View
          testID="faces-action-bar"
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: theme.card, borderTopColor: theme.border, borderTopWidth: 1, padding: 16, paddingBottom: 28, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
        >
          <Text style={{ color: theme.text, fontWeight: "700" }}>{t("faces.selectCount", { count: selected.size })}</Text>
          <Pressable
            testID="faces-assign"
            onPress={() => setAssigning(true)}
            disabled={busy}
            style={{ backgroundColor: theme.brand, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 }}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>{t("faces.assignName")}</Text>
          </Pressable>
        </View>
      ) : null}

      <AssignNameSheet
        visible={assigning}
        onAssign={(name) => {
          setAssigning(false);
          void runLabel([...selected], name);
        }}
        onCancel={() => setAssigning(false)}
      />
    </SafeAreaView>
  );
}

function FaceCard({
  face,
  tab,
  base,
  headers,
  theme,
  busy,
  selected,
  onToggle,
  onAccept,
  onReject,
}: {
  face: PersonFace;
  tab: Tab;
  base: string;
  headers: Record<string, string>;
  theme: ReturnType<typeof useTheme>;
  busy: boolean;
  selected: boolean;
  onToggle: () => void;
  onAccept: () => void;
  onReject: () => void;
}) {
  const uri = faceImageUrl(base, face);
  const isInferred = tab === "inferred";

  return (
    <View style={{ flex: 1 / 3, padding: 4 }}>
      <Pressable testID={`face-${face.id}`} onPress={isInferred ? undefined : onToggle}>
        <Image
          style={{ width: "100%", aspectRatio: 1, borderRadius: 8, backgroundColor: theme.card, borderWidth: selected ? 3 : 0, borderColor: theme.brand }}
          source={uri ? { uri, headers } : undefined}
          contentFit="cover"
          cachePolicy="disk"
        />
      </Pressable>
      {isInferred ? (
        <>
          <Text numberOfLines={1} style={{ color: theme.text, fontSize: 11, marginTop: 2 }}>
            {face.person_name ?? "—"}
          </Text>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
            <Pressable testID={`face-reject-${face.id}`} onPress={onReject} disabled={busy} hitSlop={6}>
              <Text style={{ color: "#dc2626", fontWeight: "700" }}>✗</Text>
            </Pressable>
            <Pressable testID={`face-accept-${face.id}`} onPress={onAccept} disabled={busy} hitSlop={6}>
              <Text style={{ color: "#16a34a", fontWeight: "700" }}>✓</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </View>
  );
}
