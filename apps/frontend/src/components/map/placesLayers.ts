import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  HeatmapLayerSpecification,
  SymbolLayerSpecification,
} from "maplibre-gl";
import type { MapLayerColors } from "../../theme/mapColors";

/** The layers of the Places page's clustered "locations" source of photo points (#343). */
type ClusterLayers = Readonly<{
  clusters: CircleLayerSpecification;
  clusterCount: SymbolLayerSpecification;
  unclusteredPoint: CircleLayerSpecification;
  heatmap: HeatmapLayerSpecification;
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
        "circle-radius": ["step", PHOTOS, 14, 10, 17, 50, 21],
        // A ring in the count's colour sets the accent off any basemap
        "circle-stroke-width": 2,
        "circle-stroke-color": colors.clusterText,
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
        "circle-radius": 7,
        "circle-stroke-width": 2,
        "circle-stroke-color": colors.pointStroke,
      },
    },
    heatmap: {
      id: "photo-heatmap",
      type: "heatmap",
      source: "locations",
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], PHOTOS, 0, 0, 10, 0.4, 100, 1],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 9, 3],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 4, 9, 24],
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          "transparent",
          0.3,
          colors.clusters.small,
          0.6,
          colors.clusters.medium,
          1,
          colors.clusters.large,
        ],
        "heatmap-opacity": 0.85,
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
