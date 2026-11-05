import { AnimatePresence, motion } from "motion/react";
import React from "react";
import classes from "./SlideTransition.module.css";

/**
 * The lightbox's main photo, changing with `slideKey`: the next photo fades in while the last one
 * fades out over it. With AnimatePresence's "wait" mode the next photo was not even mounted until
 * the last one's 0.4 s exit had run, so every step took about a second however fast it loaded.
 */
export function SlideTransition({ slideKey, children }: Readonly<{ slideKey: string; children: React.ReactNode }>) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={slideKey}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 1.02 }}
        transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
        className={classes.slide}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
