import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { FilterScreen } from "@/features/photos/FilterScreen";
import { libraryView } from "@/features/photos/libraryViews";
import { StubScreen } from "@/components/StubScreen";

/** One library view (favorites, videos, trash, …), opened from Collections. */
export default function LibraryViewRoute() {
  const { t } = useTranslation();
  const { filter } = useLocalSearchParams<{ filter: string }>();
  const view = libraryView(filter);
  if (!view) return <StubScreen title={t("library.unknown")} />;
  return <FilterScreen filter={view.filter} title={t(view.titleKey)} />;
}
