import { createFileRoute } from '@tanstack/react-router'
import { SocialGraph } from '../../../components/charts/SocialGraph';

export const Route = createFileRoute('/_protected/dataviz/socialgraph')({
  component: Graph,
})


export function Graph() {
  return (
    <div style={{ marginLeft: -5 }}>
      <SocialGraph height={window.innerHeight - 60} />
    </div>
  );
}