import { FACE_CLUSTER_COLORS, FACE_CLUSTER_UNKNOWN_COLOR } from "../../theme/chartColors";

/** A face on the cluster graph, in the graph's own coordinates. */
export type FacePoint = {
  x: number;
  y: number;
  size: number;
  name: string;
  color: string;
  face_url: string;
  photo: string;
  person_id: number;
};

// How far from a point, in pixels, the mouse still hovers or clicks it
const HIT_RADIUS = 20;

/** The point closest to the mouse within HIT_RADIUS; with a person picked, only theirs count. */
export function findPointNear(
  points: readonly FacePoint[],
  mouseX: number,
  mouseY: number,
  selectedPerson: string | null,
  toCanvas: (point: FacePoint) => { cx: number; cy: number }
): FacePoint | null {
  let closestPoint: FacePoint | null = null;
  let minDist = HIT_RADIUS;

  points.forEach(point => {
    if (selectedPerson && point.name !== selectedPerson) return;

    const { cx, cy } = toCanvas(point);
    const dist = Math.sqrt((mouseX - cx) ** 2 + (mouseY - cy) ** 2);

    if (dist < minDist) {
      minDist = dist;
      closestPoint = point;
    }
  });

  return closestPoint;
}

export function getColorForPerson(personName: string, index: number): string {
  if (personName === "unknown" || !personName) {
    return FACE_CLUSTER_UNKNOWN_COLOR;
  }
  return FACE_CLUSTER_COLORS[index % FACE_CLUSTER_COLORS.length] ?? FACE_CLUSTER_UNKNOWN_COLOR;
}
