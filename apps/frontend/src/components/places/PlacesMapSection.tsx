import type { UserPlace } from "@librephotos/api-client";
import { useMediaQuery } from "@mantine/hooks";
import React from "react";
import type { ResolvedMapStyle } from "../../util/mapStyle";
import { MapDisabledPlaceholder } from "../map/MapDisabledPlaceholder";
import { PlacesPhotoMap } from "../map/PlacesPhotoMap";
import type { usePlacesMap } from "../map/usePlacesMap";
import { PlaceEditorPanel } from "./PlaceEditorPanel";
import type { usePlaceEditor } from "./usePlaceEditor";
import { YourPlacesLayer } from "./YourPlacesLayer";

type Props = Readonly<{
  placesMap: ReturnType<typeof usePlacesMap>;
  mapStyle: ResolvedMapStyle;
  height: number;
  onHeightChange: (height: number) => void;
  userPlaces: readonly UserPlace[];
  placeEditor: ReturnType<typeof usePlaceEditor>;
  onOpenPlace: (place: UserPlace) => void;
}>;

/**
 * The Places page's map with your places on it (#1365), and while one is drawn its editor: over
 * the map on a wide screen, under it on a phone.
 */
export function PlacesMapSection({
  placesMap,
  mapStyle,
  height,
  onHeightChange,
  userPlaces,
  placeEditor,
  onOpenPlace,
}: Props) {
  const wide = useMediaQuery("(min-width: 48em)", true);
  const { editor } = placeEditor;
  if (mapStyle === null) return <MapDisabledPlaceholder height={height} />;
  const panel = editor && (
    <PlaceEditorPanel
      // A new form for each place opened
      key={editor.id ?? "new"}
      editor={editor}
      places={userPlaces}
      onRadiusChange={placeEditor.resize}
      onClose={placeEditor.close}
      floating={wide}
    />
  );
  return (
    <>
      <PlacesPhotoMap
        placesMap={placesMap}
        mapStyle={mapStyle}
        height={height}
        onHeightChange={onHeightChange}
        resizable={!editor}
        panel={wide ? panel : null}
        overlay={
          <YourPlacesLayer
            places={userPlaces}
            editor={editor}
            onEdgeDrag={placeEditor.dragEdge}
            onOpenPlace={onOpenPlace}
          />
        }
      />
      {!wide && panel}
    </>
  );
}
