import { Divider } from "@mantine/core";
import React, { useEffect } from "react";

import { util } from "../../api_client/util";
import { EventCountMonthGraph } from "../../components/charts/EventCountMonthGraph";
import FaceClusterScatter from "../../components/charts/FaceClusterGraph";
import { LocationDurationStackedBar } from "../../components/charts/LocationDurationStackedBar";
import { SocialGraph } from "../../components/charts/SocialGraph";
import { WordCloud } from "../../components/charts/WordCloud";
import { LocationLink } from "../../components/locationLink";
import { useAppDispatch } from "../../store/store";
import { AlbumPlace } from "../albums/AlbumPlace";

export function LocationTree() {
  return (
    <div>
      <LocationLink width={window.innerWidth - 120} height={window.innerHeight - 50} />
    </div>
  );
}

export function PhotoMap() {
  return (
    <div style={{ marginLeft: -5 }}>
      <AlbumPlace height={window.innerHeight - 55} />
    </div>
  );
}

export function WordClouds() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(util.endpoints.fetchWordCloud.initiate());
  }, []);

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

export function Timeline() {
  return (
    <div style={{ padding: 10 }}>
      <div>
        <EventCountMonthGraph />
        <Divider hidden />
        <LocationDurationStackedBar />
      </div>
    </div>
  );
}

export function Graph() {
  return (
    <div style={{ marginLeft: -5 }}>
      <SocialGraph height={window.innerHeight - 60} />
    </div>
  );
}

export function FaceScatter() {
  return (
    <div>
      <FaceClusterScatter height={window.innerHeight - 55} />
    </div>
  );
}
