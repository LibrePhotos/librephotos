import { createFileRoute } from '@tanstack/react-router'
import { Profile } from '../../components/settings/Profile'

export const Route = createFileRoute('/_protected/profile')({
  component: RouteComponent,
})

function RouteComponent() {
  return <Profile />
}
