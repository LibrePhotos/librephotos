import { Title } from "@mantine/core";
import React from "react";
import type { ReactNode } from "react";
import classes from "./SharingOverview.module.css";

type Props = Readonly<{
  /** The row's 24px glyph, dimmed. */
  icon: ReactNode;
  title: string;
  /** One dimmed line: what the section holds, or that it is empty. */
  description: ReactNode;
  /** On the right, level with the title: "View all ›" or the section's one button. */
  action?: ReactNode;
  /** Under the row: its preview, its people. */
  children?: ReactNode;
}>;

/**
 * One section of the Sharing overview, drawn one way for all of them: icon, a 15px/600 title with
 * its 13px dimmed line, the action on the right, and what it holds underneath. No box: the
 * overview's list puts a hairline between sections (SharingOverview.module.css `.list`).
 */
export function SharingRow({ icon, title, description, action, children }: Props) {
  return (
    <section className={classes.section}>
      <div className={classes.row}>
        <span className={classes.icon} aria-hidden>
          {icon}
        </span>
        <div className={classes.text}>
          <Title order={2} className={classes.title}>
            {title}
          </Title>
          <div className={classes.description}>{description}</div>
        </div>
        {action ? <div className={classes.action}>{action}</div> : null}
      </div>
      {children ? <div className={classes.body}>{children}</div> : null}
    </section>
  );
}
