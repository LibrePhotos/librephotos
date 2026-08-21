import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/Icon";

/**
 * A video slide, played with `expo-video`.
 *
 * `expo-video` is bundled in Expo Go, so this needs no dev build — the
 * constraint that rules out most native modules in this app (README "Dependency
 * constraints"). Its `VideoSource` accepts request headers, which React Native
 * needs because there is no shared cookie jar for `/media/` the way the web
 * frontend relies on.
 *
 * **Only the active slide mounts a player.** A pager window is up to 500 slides
 * and each `useVideoPlayer` is a real native player holding a decoder; mounting
 * them all would exhaust the device. Inactive video slides render their poster
 * with a play badge, which is also what the user actually wants to see while
 * swiping past.
 */
export function VideoSlide({
  uri,
  posterUri,
  headers,
  width,
  height,
  active,
  onTap,
  testID,
}: {
  uri: string;
  posterUri: string | null;
  headers: Record<string, string>;
  width: number;
  height: number;
  active: boolean;
  onTap?: () => void;
  testID?: string;
}) {
  if (!active) {
    return (
      <VideoPoster
        testID={testID}
        posterUri={posterUri}
        headers={headers}
        width={width}
        height={height}
        onTap={onTap}
      />
    );
  }
  return (
    <ActiveVideo
      testID={testID}
      uri={uri}
      headers={headers}
      width={width}
      height={height}
      onTap={onTap}
    />
  );
}

function VideoPoster({
  posterUri,
  headers,
  width,
  height,
  onTap,
  testID,
}: {
  posterUri: string | null;
  headers: Record<string, string>;
  width: number;
  height: number;
  onTap?: () => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onTap}
      accessibilityRole="button"
      accessibilityLabel={t("viewer.playVideo")}
      style={{ width, height, alignItems: "center", justifyContent: "center" }}
    >
      <Image
        testID={testID}
        source={posterUri ? { uri: posterUri, headers } : undefined}
        style={{ width, height }}
        contentFit="contain"
        cachePolicy="disk"
        transition={150}
      />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: "rgba(0,0,0,0.5)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="play" size={28} color="#ffffff" />
      </View>
      <Text
        style={{
          position: "absolute",
          bottom: height * 0.16,
          color: "rgba(255,255,255,0.85)",
          fontSize: 12,
        }}
      >
        {t("viewer.video")}
      </Text>
    </Pressable>
  );
}

function ActiveVideo({
  uri,
  headers,
  width,
  height,
  onTap,
  testID,
}: {
  uri: string;
  headers: Record<string, string>;
  width: number;
  height: number;
  onTap?: () => void;
  testID?: string;
}) {
  const player = useVideoPlayer({ uri, headers }, (instance) => {
    instance.loop = false;
    // Autoplay: a tap that opened a video is a request to watch it. Muted
    // start is a browser convention, not a phone one — the user chose this.
    instance.play();
  });

  return (
    <Pressable
      onPress={onTap}
      style={{ width, height, alignItems: "center", justifyContent: "center" }}
    >
      <VideoView
        testID={testID}
        player={player}
        style={{ width, height }}
        contentFit="contain"
        nativeControls
        allowsFullscreen
        allowsPictureInPicture={false}
      />
    </Pressable>
  );
}
