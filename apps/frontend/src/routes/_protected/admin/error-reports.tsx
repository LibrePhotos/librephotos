import { createFileRoute } from "@tanstack/react-router";
import { ErrorReportsPage } from "../../../components/errorReports/ErrorReportsPage";

export const Route = createFileRoute("/_protected/admin/error-reports")({
  component: ErrorReportsPage,
});
