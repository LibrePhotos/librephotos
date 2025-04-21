import { createFileRoute } from '@tanstack/react-router'
import { Library } from '../../components/settings/Library'
export const Route = createFileRoute('/_protected/library')({
  component: RouteComponent,
})

function RouteComponent() {
  return <Library />
}
