import { createFileRoute } from "@tanstack/react-router";
import { LocationLink } from "../../../components/locationLink";

export const Route = createFileRoute("/_protected/dataviz/placetree")({ component: LocationLink });
