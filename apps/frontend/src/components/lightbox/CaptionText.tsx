import React from "react";
import { captionParts } from "./captionMarkup";
import classes from "./Description.module.css";
import hashtagClasses from "./Hashtag.module.css";

/**
 * A caption that is not being edited: plain text with its hashtags as pills, laid out as the
 * read-only editor showed it (one paragraph, the editor's type), without loading the editor.
 */
export function CaptionText({ caption }: Readonly<{ caption: string }>) {
  return (
    <div className={classes.captionText}>
      <p>
        {captionParts(caption).map(part =>
          part.hashtag ? (
            <span key={part.start} className={hashtagClasses.hashtag}>
              {part.text}
            </span>
          ) : (
            <React.Fragment key={part.start}>{part.text}</React.Fragment>
          )
        )}
      </p>
    </div>
  );
}
