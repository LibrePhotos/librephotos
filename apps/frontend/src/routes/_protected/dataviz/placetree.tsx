import { createFileRoute } from "@tanstack/react-router";
import { LocationLink } from "../../../components/locationLink";

export const Route = createFileRoute("/_protected/dataviz/placetree")();

export function LocationTree() {
  return (
    <div>
      <LocationLink width={window.innerWidth - 120} height={window.innerHeight - 50} />
    </div>
  );
}

Route.update({ component: LocationTree });
