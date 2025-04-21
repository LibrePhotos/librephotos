import { createFileRoute } from '@tanstack/react-router'

import FaceClusterScatter from "../../../components/charts/FaceClusterGraph";

export const Route = createFileRoute('/_protected/dataviz/facescatter')({
  component: FaceScatter,
})

export function FaceScatter() {
  return (
    <div>
      <FaceClusterScatter height={window.innerHeight - 55} />
    </div>
  );
}

