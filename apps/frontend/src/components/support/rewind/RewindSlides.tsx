import type { PigPhoto, Rewind } from "@librephotos/api-client";
import { Avatar, Box, Button, Group, Stack, Text } from "@mantine/core";
import { IconBrandGithub as Github } from "@tabler/icons-react";
import clsx from "clsx";
import { DateTime } from "luxon";
import React from "react";
import { useTranslation } from "react-i18next";
import { serverAddress } from "../../../api_client/urls";
import { GITHUB_REPO_LINK } from "../../../uiConstants";
import { parseCalendarDay } from "../../../util/dateUtils";
import { MediaThumbnail } from "../../common/MediaThumbnail";
import { usd } from "../cloudPrices";
import { SupportButtons } from "../SupportButtons";
import classes from "./Rewind.module.css";
import { busiestMonth, pace, quietestMonth, type RewindSlideKey } from "./slidePlan";

type SlideProps = Readonly<{ rewind: Rewind }>;

const PACE_KEYS = { day: "rewind.perday", week: "rewind.perweek", month: "rewind.permonth" } as const;

type ThumbnailsProps = Readonly<{
  photos: readonly PigPhoto[];
  className: string | undefined;
  /** The thumbnail's size on the widest card; a narrower card crops each one to its square cell. */
  size: number;
}>;

function Thumbnails({ photos, className, size }: ThumbnailsProps) {
  if (photos.length === 0) return null;
  return (
    <div className={className}>
      {photos.map(photo => (
        <div key={photo.id} className={classes.cell}>
          <MediaThumbnail imageHash={photo.image_hash} size={size} video={photo.type === "video"} radius={0} />
        </div>
      ))}
    </div>
  );
}

function IntroSlide({ rewind }: SlideProps) {
  const { t } = useTranslation();
  return (
    <div className={clsx(classes.slide, classes.intro)}>
      <div className={classes.eyebrow}>LibrePhotos</div>
      <div className={classes.title}>{t("rewind.title", { year: rewind.year })}</div>
      <div className={classes.body}>{t("rewind.intro")}</div>
      <Box className={classes.bottom}>
        <Thumbnails photos={rewind.cover_photos} className={classes.collage} size={100} />
      </Box>
    </div>
  );
}

function CountSlide({ rewind }: SlideProps) {
  const { t, i18n } = useTranslation();
  const total = rewind.photo_count + rewind.video_count;
  const day = rewind.busiest_day;
  const often = pace(total, rewind.year);
  const dayName = day ? parseCalendarDay(day.date).toLocaleString({ day: "numeric", month: "long" }) : "";
  return (
    <div className={clsx(classes.slide, classes.count)}>
      <div className={classes.lead}>{t("rewind.captured")}</div>
      <div className={classes.huge}>{new Intl.NumberFormat(i18n.language).format(total)}</div>
      <div className={classes.lead}>{t("rewind.photosandvideos", { count: total })}</div>
      <div className={classes.body}>
        {often ? `${t(PACE_KEYS[often.per], { count: often.count })} ` : null}
        {day ? t("rewind.busiestday", { date: dayName, count: day.count }) : null}
      </div>
      <Box className={classes.bottom}>
        <Thumbnails photos={rewind.busiest_day_photos} className={classes.collage4} size={75} />
      </Box>
    </div>
  );
}

function PeopleSlide({ rewind }: SlideProps) {
  const { t } = useTranslation();
  const [top, ...others] = rewind.people;
  if (!top) return null;
  return (
    <div className={clsx(classes.slide, classes.people)}>
      <div className={classes.lead}>{t("rewind.mostphotographed")}</div>
      <Avatar
        src={top.face_url ? serverAddress + top.face_url : null}
        size={148}
        radius={999}
        className={classes.topFace}
        alt=""
      >
        {top.name.slice(0, 1)}
      </Avatar>
      <div className={classes.title}>{top.name}</div>
      <div className={classes.body}>{t("rewind.inphotos", { count: top.photo_count })}</div>
      {others.length > 0 ? (
        <Stack gap={6} className={classes.bottom} align="center">
          <Text size="sm">{t("rewind.followedby")}</Text>
          <Group gap="md" justify="center">
            {others.map(person => (
              <Stack key={person.id} gap={4} align="center">
                <Avatar src={person.face_url ? serverAddress + person.face_url : null} size={48} radius={999} alt="">
                  {person.name.slice(0, 1)}
                </Avatar>
                <Text size="xs">{person.name}</Text>
              </Stack>
            ))}
          </Group>
        </Stack>
      ) : null}
    </div>
  );
}

function PlacesSlide({ rewind }: SlideProps) {
  const { t, i18n } = useTranslation();
  return (
    <div className={clsx(classes.slide, classes.places)}>
      <div className={classes.lead}>{t("rewind.wentplaces")}</div>
      <div className={classes.huge}>{new Intl.NumberFormat(i18n.language).format(rewind.place_count)}</div>
      <div className={classes.lead}>
        {t("rewind.places", { count: rewind.place_count })}
        {rewind.country_count > 1 ? ` ${t("rewind.countries", { count: rewind.country_count })}` : null}
      </div>
      <Stack gap={8} className={classes.bottom}>
        <Text size="sm">{t("rewind.topplaces")}</Text>
        {rewind.top_places.map((place, index) => (
          <div key={place.name} className={classes.placeRow}>
            <Text fw={800} size="lg" w={18}>
              {index + 1}
            </Text>
            <Text fw={600} flex={1} truncate>
              {place.name}
            </Text>
            <Text size="sm">{t("rewind.inphotos", { count: place.photo_count })}</Text>
          </div>
        ))}
      </Stack>
    </div>
  );
}

function MonthsSlide({ rewind }: SlideProps) {
  const { t } = useTranslation();
  const best = busiestMonth(rewind.months);
  const quiet = quietestMonth(rewind.months);
  const most = Math.max(...rewind.months, 1);
  const monthName = (month: number, style: "long" | "narrow") =>
    DateTime.utc(rewind.year, month + 1, 1).toLocaleString({ month: style });
  return (
    <div className={clsx(classes.slide, classes.months)}>
      <div className={classes.lead}>{t("rewind.busiestmonth")}</div>
      <Text className={classes.title} c="yellow.4">
        {monthName(best, "long")}
      </Text>
      <div className={classes.body}>
        {t("rewind.monthcount", { count: rewind.months[best] ?? 0 })}{" "}
        {quiet === best ? null : t("rewind.quietestmonth", { month: monthName(quiet, "long") })}
      </div>
      <Box className={classes.bottom}>
        <div className={classes.bars} aria-hidden="true">
          {rewind.months.map((count, month) => (
            <Box
              // eslint-disable-next-line react/no-array-index-key -- the twelve months never reorder
              key={month}
              className={classes.bar}
              h={`${Math.round((count / most) * 100)}%`}
              data-best={month === best || undefined}
            />
          ))}
        </div>
        <div className={classes.barLabels} aria-hidden="true">
          {rewind.months.map((_, month) => (
            // eslint-disable-next-line react/no-array-index-key -- the twelve months never reorder
            <span key={month}>{monthName(month, "narrow")}</span>
          ))}
        </div>
      </Box>
    </div>
  );
}

type EndSlideProps = SlideProps &
  Readonly<{
    /** What the cheapest cloud plan for the library would have cost this year; 0 hides it. */
    saving: number;
    /** Admins on a server that allows it: ask for a sponsorship; everyone else: a star. */
    asksForSupport: boolean;
    onAction: () => void;
  }>;

function EndSlide({ saving, asksForSupport, onAction }: EndSlideProps) {
  const { t, i18n } = useTranslation();
  return (
    <div className={clsx(classes.slide, classes.end)}>
      <Text className={classes.title} fz={30}>
        {t("rewind.stayedhome")}
      </Text>
      <div className={classes.body}>{t("rewind.private")}</div>
      {saving > 0 ? (
        <div className={classes.saving}>
          <Text fw={800} fz={26} c="inherit">
            {usd(saving, i18n.language)}
          </Text>
          <Text size="xs" c="inherit">
            {t("rewind.saved")}
          </Text>
        </div>
      ) : null}
      <Stack gap="sm" className={classes.bottom}>
        {asksForSupport ? (
          <>
            <div className={classes.body}>{t("rewind.ask")}</div>
            <SupportButtons onAction={onAction} stacked />
          </>
        ) : (
          <>
            <div className={classes.body}>{t("rewind.askstar")}</div>
            <Button
              component="a"
              href={GITHUB_REPO_LINK}
              target="_blank"
              rel="noreferrer"
              color="dark"
              fullWidth
              leftSection={<Github size={16} />}
            >
              {t("support.star")}
            </Button>
          </>
        )}
      </Stack>
    </div>
  );
}

type RewindSlideProps = SlideProps &
  Readonly<{
    slide: RewindSlideKey;
    saving: number;
    asksForSupport: boolean;
    onAction: () => void;
  }>;

export function RewindSlide({ slide, rewind, saving, asksForSupport, onAction }: RewindSlideProps) {
  switch (slide) {
    case "intro":
      return <IntroSlide rewind={rewind} />;
    case "count":
      return <CountSlide rewind={rewind} />;
    case "people":
      return <PeopleSlide rewind={rewind} />;
    case "places":
      return <PlacesSlide rewind={rewind} />;
    case "months":
      return <MonthsSlide rewind={rewind} />;
    case "end":
      return <EndSlide rewind={rewind} saving={saving} asksForSupport={asksForSupport} onAction={onAction} />;
  }
}
