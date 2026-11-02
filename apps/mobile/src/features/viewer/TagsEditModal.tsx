import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/Icon";
import { useToastStore } from "@/stores/toasts";
import { useTheme } from "@/theme";
import { Chip, chipRowStyle } from "./InfoPrimitives";
import { ModalSheet } from "./ViewerSheets";
import { useAllTags, usePhotoTags, useTagEdits } from "./usePhotoTags";

const MAX_SUGGESTIONS = 8;

/**
 * Add and remove the photo's tags. Each change is saved at once (there is no
 * draft to lose on a phone that locks), and the list re-reads from the server.
 * Online-only; the caller opens it only with a connection.
 */
export function TagsEditModal({
  visible,
  photoId,
  onClose,
}: {
  visible: boolean;
  /** The photo's id (or hash): the tag endpoints take either. */
  photoId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ModalSheet visible={visible} title={t("viewer.editTags")} onClose={onClose} testID="viewer-tags-editor">
      <TagsEditor photoId={photoId} />
    </ModalSheet>
  );
}

/** The sheet's content; mounted on each opening, so the tag lists are read only while it is open. */
function TagsEditor({ photoId }: { photoId: string | null }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const pushToast = useToastStore((s) => s.push);
  const tags = usePhotoTags(photoId, true);
  const allTags = useAllTags(true);
  const { addTag, removeTag } = useTagEdits(photoId);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const current = useMemo(() => tags.data ?? [], [tags.data]);
  const typed = text.trim();
  const suggestions = useMemo(() => {
    const needle = typed.toLowerCase();
    return allTags
      .filter((tag) => !current.some((c) => c.id === tag.id))
      .filter((tag) => (needle ? tag.name.toLowerCase().includes(needle) : true))
      .slice(0, MAX_SUGGESTIONS);
  }, [allTags, current, typed]);

  const run = async (change: () => Promise<void>) => {
    setBusy(true);
    try {
      await change();
    } catch {
      pushToast({ level: "error", message: t("viewer.tagsError") });
    } finally {
      setBusy(false);
    }
  };

  const add = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || current.some((c) => c.name === trimmed)) {
      setText("");
      return;
    }
    setText("");
    void run(() => addTag(trimmed, allTags));
  };

  return (
    <>
      <View testID="viewer-tags-current" style={chipRowStyle()}>
        {tags.isLoading ? <ActivityIndicator size="small" color={theme.muted} /> : null}
        {!tags.isLoading && current.length === 0 ? (
          <Text style={{ color: theme.muted, fontSize: 13 }}>{t("viewer.noTags")}</Text>
        ) : null}
        {current.map((tag) => (
          <Chip
            key={tag.id}
            testID={`viewer-tag-remove-${tag.id}`}
            label={tag.name}
            disabled={busy}
            onPress={() => void run(() => removeTag(tag.id))}
            leading={<Icon name="clear" size={14} color={theme.muted} />}
          />
        ))}
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <TextInput
          testID="viewer-tag-input"
          value={text}
          onChangeText={setText}
          placeholder={t("viewer.addTag")}
          placeholderTextColor={theme.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => add(text)}
          style={{
            flex: 1,
            minHeight: 44,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 10,
            paddingHorizontal: 12,
            color: theme.text,
            backgroundColor: theme.background,
          }}
        />
        <Pressable
          testID="viewer-tag-add"
          onPress={() => add(text)}
          disabled={!typed || busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: !typed || busy }}
          hitSlop={8}
          style={{ minHeight: 44, justifyContent: "center", opacity: !typed || busy ? 0.45 : 1 }}
        >
          <Text style={{ color: theme.brand, fontWeight: "700" }}>{t("viewer.add")}</Text>
        </Pressable>
      </View>

      {suggestions.length > 0 ? (
        <View testID="viewer-tag-suggestions" style={chipRowStyle()}>
          {suggestions.map((tag) => (
            <Chip
              key={tag.id}
              testID={`viewer-tag-suggestion-${tag.id}`}
              label={tag.name}
              disabled={busy}
              onPress={() => add(tag.name)}
            />
          ))}
        </View>
      ) : null}
    </>
  );
}
