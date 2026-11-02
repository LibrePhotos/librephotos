import { ActionIcon, Box, Modal } from "@mantine/core";
import { IconChevronLeft as ChevronLeft, IconChevronRight as ChevronRight, IconX as X } from "@tabler/icons-react";
import clsx from "clsx";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useGetSettingsQuery } from "../../../api_client/settings/hooks";
import { useFetchCountStatsQuery } from "../../../api_client/stats/hooks/useFetchCountStatsQuery";
import { useRewindQuery } from "../../../api_client/stats/hooks/useRewindQuery";
import { useCurrentUserSelfDetailsQuery } from "../../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { PageLoader } from "../../common/PageLoader";
import { yearlySaving } from "../cloudPrices";
import { asksForSupport } from "../supportPrompts";
import classes from "./Rewind.module.css";
import { RewindSlide } from "./RewindSlides";
import { rewindSlides } from "./slidePlan";

type RewindModalProps = Readonly<{
  year: number;
  onClose: () => void;
}>;

/**
 * Rewind: the user's year in photos, a few story-like slides with a progress bar on top. The
 * arrows, the buttons beside the card and a click on the card move between the slides; Escape, the
 * close button and the overlay close it. The last slide asks admins to sponsor LibrePhotos (when the
 * server allows it) and everyone else to star it.
 */
export function RewindModal({ year, onClose }: RewindModalProps) {
  const { t } = useTranslation();
  const { data: rewind } = useRewindQuery(year);
  const { data: user } = useCurrentUserSelfDetailsQuery();
  const { data: settings } = useGetSettingsQuery();
  const asks = asksForSupport(user, settings);
  // The library's size, for what a cloud plan would have cost this year.
  const { data: stats } = useFetchCountStatsQuery();
  const [index, setIndex] = useState(0);

  const slides = rewind ? rewindSlides(rewind) : [];
  const last = slides.length - 1;
  const current = slides[Math.min(index, last)];
  const go = (next: number) => setIndex(Math.max(0, Math.min(last, next)));

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowRight") go(index + 1);
    else if (event.key === "ArrowLeft") go(index - 1);
    else return;
    event.preventDefault();
  };
  // A click on the card's left third goes back, elsewhere forward; links and buttons keep theirs.
  const onCardClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("a, button")) return;
    const box = event.currentTarget.getBoundingClientRect();
    go(event.clientX - box.left < box.width / 3 ? index - 1 : index + 1);
  };

  return (
    <Modal.Root opened onClose={onClose} centered size="auto" data-testid="rewind">
      <Modal.Overlay backgroundOpacity={0.82} blur={2} />
      <Modal.Content aria-label={t("rewind.title", { year })} bg="transparent" shadow="none" onKeyDown={onKeyDown}>
        <Modal.Body p={0}>
          <ActionIcon
            className={classes.close}
            variant="subtle"
            color="gray.0"
            size="xl"
            radius="xl"
            onClick={onClose}
            aria-label={t("rewind.close")}
          >
            <X size={24} />
          </ActionIcon>
          <div className={classes.stage}>
            <ActionIcon
              className={classes.nav}
              variant="white"
              color="dark"
              size={48}
              radius="xl"
              onClick={() => go(index - 1)}
              disabled={index === 0}
              aria-label={t("rewind.previous")}
            >
              <ChevronLeft size={22} />
            </ActionIcon>
            {/* The card takes clicks as a convenience; the buttons and arrow keys do the same. */}
            <div className={clsx(classes.card, current === "end" && classes.light)} onClick={onCardClick}>
              {rewind && current ? (
                <>
                  <div className={classes.progress} aria-hidden="true">
                    {slides.map((slide, i) => (
                      <span key={slide} className={classes.segment} data-done={i <= index || undefined} />
                    ))}
                  </div>
                  <RewindSlide
                    slide={current}
                    rewind={rewind}
                    saving={yearlySaving(stats?.library_bytes ?? 0)}
                    asksForSupport={asks}
                    onAction={onClose}
                  />
                </>
              ) : (
                <Box h="100%" bg="white">
                  <PageLoader label={t("rewind.title", { year })} />
                </Box>
              )}
            </div>
            <ActionIcon
              className={classes.nav}
              variant="white"
              color="dark"
              size={48}
              radius="xl"
              onClick={() => go(index + 1)}
              disabled={index >= last}
              aria-label={t("rewind.next")}
            >
              <ChevronRight size={22} />
            </ActionIcon>
          </div>
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}
