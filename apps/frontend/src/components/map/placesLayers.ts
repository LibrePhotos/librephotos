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

export const PHOTO_DENSITY_SOURCE = "photo-density";

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
      source: PHOTO_DENSITY_SOURCE,
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], PHOTOS, 1, 0.35, 10, 0.6, 100, 0.85, 1000, 1],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 6, 2, 12, 3],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 14, 4, 20, 9, 30, 14, 40],
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          colors.heatmap.fade,
          0.08,
          colors.heatmap.ramp[0],
          0.3,
          colors.heatmap.ramp[1],
          0.55,
          colors.heatmap.ramp[2],
          0.8,
          colors.heatmap.ramp[3],
          1,
          colors.heatmap.ramp[4],
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
