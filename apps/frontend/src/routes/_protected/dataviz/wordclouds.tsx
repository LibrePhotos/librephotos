import { Divider } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import { WordCloud } from "../../../components/charts/WordCloud";

export const Route = createFileRoute("/_protected/dataviz/wordclouds")();

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

Route.update({ component: WordClouds });
