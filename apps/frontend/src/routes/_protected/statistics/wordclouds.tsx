import { Grid } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import { StatisticsNav } from "../../../components/charts/StatisticsNav";
import { WordCloud } from "../../../components/charts/WordCloud";

export const Route = createFileRoute("/_protected/statistics/wordclouds")();

function WordClouds() {
  return (
    <StatisticsNav>
      <Grid>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <WordCloud height={Math.max(300, window.innerHeight - 280)} type="location" />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <WordCloud height={Math.max(300, window.innerHeight - 280)} type="captions" />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <WordCloud height={Math.max(300, window.innerHeight - 280)} type="people" />
        </Grid.Col>
      </Grid>
    </StatisticsNav>
  );
}

Route.update({ component: WordClouds });
