import { BarChart } from "@mantine/charts";
import { Loader, ScrollArea, Stack, Title } from "@mantine/core";
import { IconMapPin } from "@tabler/icons-react";
import { DateTime } from "luxon";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocationTimelineQuery } from "../../api_client/stats/hooks";
import { i18nResolvedLanguage } from "../../i18n";
import { EmptyState } from "../common/EmptyState";

export function LocationDurationStackedBar() {
  const { data: locationTimeline = [], isSuccess: fetchedLocationTimeline, isLoading } = useLocationTimelineQuery();
  const { t } = useTranslation();
  const [hoveredSegment, setHoveredSegment] = useState<string | null>(null);

  // Transform data for Mantine BarChart - stacked timeline
  const chartData =
    fetchedLocationTimeline && locationTimeline.length > 0
      ? [
          locationTimeline.reduce(
            (acc: Record<string, number | string>, el: { loc: string; data: number[] }) => {
              const [first] = el.data;
              acc[el.loc] = first;
              return acc;
            },
            { label: "" }
          ),
        ]
      : [];

  const series = locationTimeline.map((el: { loc: string; color: string }) => ({
    name: el.loc,
    color: el.color,
  }));

  // Build a lookup for tooltip
  const locationLookup = locationTimeline.reduce(
    (acc: Record<string, { start: number; end: number }>, el: { loc: string; start: number; end: number }) => {
      acc[el.loc] = { start: el.start, end: el.end };
      return acc;
    },
    {}
  );

  function getTooltipContent(active: boolean) {
    if (!active || !hoveredSegment) return null;

    const locData = locationLookup[hoveredSegment];
    if (!locData) return null;

    const segmentColor = series.find(s => s.name === hoveredSegment)?.color;
    const startDate = DateTime.fromSeconds(locData.start)
      .setLocale(i18nResolvedLanguage())
      .toLocaleString({ year: "numeric", month: "short" });
    const endDate = DateTime.fromSeconds(locData.end)
      .setLocale(i18nResolvedLanguage())
      .toLocaleString({ year: "numeric", month: "short" });

    return (
      <div
        style={{
          background: "var(--mantine-color-body)",
          border: "1px solid var(--mantine-color-default-border)",
          borderRadius: "var(--mantine-radius-sm)",
          padding: "8px 12px",
          boxShadow: "var(--mantine-shadow-md)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              backgroundColor: segmentColor,
              flexShrink: 0,
            }}
          />
          <div style={{ fontWeight: 500 }}>{hoveredSegment}</div>
        </div>
        <div style={{ color: "var(--mantine-color-dimmed)", fontSize: "0.875rem", marginTop: 4 }}>
          {startDate} – {endDate}
        </div>
      </div>
    );
  }

  return (
    <Stack>
      <Title order={3}>{t("locationtimeline")}</Title>
      {isLoading && <Loader />}
      {locationTimeline.length === 0 && fetchedLocationTimeline && !isLoading && (
        <EmptyState
          icon={<IconMapPin size={40} />}
          title={t("emptystate.places.title")}
          description={t("emptystate.places.description")}
          actionLabel={t("emptystate.goToLibrary")}
          actionLink="/library"
        />
      )}
      {fetchedLocationTimeline && locationTimeline.length > 0 && (
        <>
          <BarChart
            h={80}
            data={chartData}
            dataKey="label"
            orientation="vertical"
            type="stacked"
            series={series}
            withYAxis={false}
            withXAxis={false}
            gridAxis="none"
            barProps={{
              radius: 4,
              onMouseMove: (data: { tooltipPayload?: Array<{ name?: string }> }) => {
                const segmentName = data?.tooltipPayload?.[0]?.name;
                if (segmentName && segmentName !== hoveredSegment) {
                  setHoveredSegment(segmentName);
                }
              },
              onMouseLeave: () => setHoveredSegment(null),
            }}
            tooltipAnimationDuration={200}
            cursorFill="var(--mantine-color-gray-light)"
            tooltipProps={{ content: ({ active }) => getTooltipContent(active) }}
          />
          <ScrollArea type="auto" offsetScrollbars>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", paddingTop: 8 }}>
              {series.map(s => (
                <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 2,
                      backgroundColor: s.color,
                    }}
                  />
                  <span style={{ fontSize: "0.75rem" }}>{s.name}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </>
      )}
    </Stack>
  );
}
