import { createFileRoute } from '@tanstack/react-router'
import { WordCloud } from '../../../components/charts/WordCloud';
import { Divider } from '@mantine/core';

export const Route = createFileRoute('/_protected/dataviz/wordclouds')({
  component: WordClouds,
})

export function WordClouds() {
  return (
    <div style={{ padding: 10 }}>
      <div>
        <WordCloud height={320} type="location" />
        <Divider hidden />
        <WordCloud height={320} type="captions" />
        <Divider hidden />
        <WordCloud height={320} type="people" />
      </div>
    </div>
  );
} 
