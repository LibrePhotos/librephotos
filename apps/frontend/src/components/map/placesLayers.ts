import type { CircleLayerSpecification, ExpressionSpecification, SymbolLayerSpecification } from "maplibre-gl";
import type { MapLayerColors } from "../../theme/mapColors";

/** The layers of the Places page's clustered "locations" source of photo points (#343). */
type ClusterLayers = Readonly<{
  clusters: CircleLayerSpecification;
  clusterCount: SymbolLayerSpecification;
  unclusteredPoint: CircleLayerSpecification;
}>;

/** The photos a point or a cluster stands for: each point's `photos`, which a cluster sums. */
const PHOTOS: ExpressionSpecification = ["get", "photos"];
/** More than one photo: a cluster, or a spot where several were taken. */
const SEVERAL: ExpressionSpecification = [">", PHOTOS, 1];

/** "7", "512", "3.2k": the count on a circle. */
const PHOTOS_LABEL: ExpressionSpecification = [
  "case",
  [">=", PHOTOS, 1000],
  ["concat", ["to-string", ["/", ["round", ["/", PHOTOS, 100]], 10]], "k"],
  ["to-string", PHOTOS],
];

/** Circles sized and coloured by photo count with their count, and single photos as dots. */
export function clusterLayers(colors: MapLayerColors): ClusterLayers {
  return {
    clusters: {
      id: "clusters",
      type: "circle",
      source: "locations",
      filter: SEVERAL,
      paint: {
        "circle-color": ["step", PHOTOS, colors.clusters.small, 10, colors.clusters.medium, 50, colors.clusters.large],
        "circle-radius": ["step", PHOTOS, 15, 10, 20, 50, 25],
      },
    },
    clusterCount: {
      id: "cluster-count",
      type: "symbol",
      source: "locations",
      filter: SEVERAL,
      layout: {
        "text-field": PHOTOS_LABEL,
        "text-font": ["Open Sans Bold"],
        "text-size": 12,
      },
      paint: { "text-color": colors.clusterText },
    },
    unclusteredPoint: {
      id: "unclustered-point",
      type: "circle",
      source: "locations",
      filter: ["!", SEVERAL],
      paint: {
        "circle-color": colors.point,
        "circle-radius": 8,
        "circle-stroke-width": 2,
        "circle-stroke-color": colors.pointStroke,
      },
    },
  };
}

/** Every place as a small dot, for the album hub's places card. */
export function miniPointLayer(colors: MapLayerColors): CircleLayerSpecification {
  return {
    id: "points",
    type: "circle",
    source: "locations",
    paint: {
      "circle-color": colors.point,
      "circle-radius": 4,
      "circle-stroke-width": 1,
      "circle-stroke-color": colors.pointStroke,
    },
  };
}
