import { UnstyledButton } from "@mantine/core";
import { IconWand as Wand } from "@tabler/icons-react";
import React from "react";

import classes from "./AISuggestionButton.module.css";

type Props = Readonly<{
  suggestion: string;
  onClick: () => void;
}>;

export function AISuggestionButton({ suggestion, onClick }: Props) {
  return (
    <UnstyledButton
      className={classes.aiSuggestionButton}
      onClick={onClick}
    >
      <div className={classes.aiSuggestionButtonInner}>
        <Wand size={16} />
        <span className={classes.aiSuggestionButtonLabel}>
          {suggestion}
        </span>
      </div>
    </UnstyledButton>
  );
} 