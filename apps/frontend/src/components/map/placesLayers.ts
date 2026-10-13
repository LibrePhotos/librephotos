import type { CircleLayerSpecification, SymbolLayerSpecification } from "maplibre-gl";
import type { MapLayerColors } from "../../theme/mapColors";

/** The layers of the Places page's clustered "locations" source. */
type ClusterLayers = Readonly<{
  clusters: CircleLayerSpecification;
  clusterCount: SymbolLayerSpecification;
  unclusteredPoint: CircleLayerSpecification;
}>;

/** Clusters sized and coloured by photo count, their count, and single places. */
export function clusterLayers(colors: MapLayerColors): ClusterLayers {
  return {
    clusters: {
      id: "clusters",
      type: "circle",
      source: "locations",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": [
          "step",
          ["get", "point_count"],
          colors.clusters.small,
          10,
          colors.clusters.medium,
          50,
          colors.clusters.large,
        ],
        "circle-radius": ["step", ["get", "point_count"], 15, 10, 20, 50, 25],
      },
    },
    clusterCount: {
      id: "cluster-count",
      type: "symbol",
      source: "locations",
      filter: ["has", "point_count"],
      layout: {
        "text-field": "{point_count_abbreviated}",
        "text-font": ["Open Sans Bold"],
        "text-size": 12,
      },
      paint: { "text-color": colors.clusterText },
    },
    unclusteredPoint: {
      id: "unclustered-point",
      type: "circle",
      source: "locations",
      filter: ["!", ["has", "point_count"]],
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
