import { createFileRoute } from '@tanstack/react-router'
import { AdminPage } from '../../components/settings/AdminPage'

export const Route = createFileRoute('/_protected/admin')({
  component: RouteComponent,
})

function RouteComponent() {
  return <AdminPage />
}
