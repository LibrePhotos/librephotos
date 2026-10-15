import { Avatar, Text, UnstyledButton } from "@mantine/core";
import React, { useId } from "react";
import { useTranslation } from "react-i18next";
import type { CompletePersonFace } from "../../api_client/faces/types";
import { useFocusOnMount } from "./hooks/useFocusOnMount";
import classes from "./PersonCell.module.css";

type Props = Readonly<{
  person: CompletePersonFace;
  /** The face that stands for the person; the avatar's placeholder while there is none. */
  coverUrl: string | undefined;
  style: React.CSSProperties;
  entrySquareSize: number;
  onExpand: () => void;
  /** The person was just folded: this cell takes the focus the header's toggle had. */
  takeFocus: boolean;
  onFocused: () => void;
}>;

// The name and face count under the face
const CAPTION_HEIGHT = 38;

/**
 * A collapsed person: one grid cell with their cover face, name and face count, so a fully
 * collapsed dashboard is a grid of people (#860). Clicking it expands the person in place.
 */
export function PersonCell({ person, coverUrl, style, entrySquareSize, onExpand, takeFocus, onFocused }: Props) {
  const { t } = useTranslation();
  const buttonRef = useFocusOnMount<HTMLButtonElement>(takeFocus, onFocused);
  const countId = useId();
  // The same inset as a face, so people and faces line up
  const size = entrySquareSize - 10;
  // A round face like on the People page (#2241), with the name and count under it
  const faceSize = Math.max(size - CAPTION_HEIGHT, 0);

  return (
    <div style={style} className={classes.cell}>
      <UnstyledButton
        ref={buttonRef}
        className={classes.button}
        w={size}
        h={size}
        onClick={onExpand}
        aria-expanded={false}
        aria-label={t("facesdashboard.expandperson", { name: person.name })}
        aria-describedby={countId}
        title={person.name}
      >
        <Avatar src={coverUrl} alt="" size={faceSize} className={classes.face} />
        <span className={classes.caption}>
          <Text component="span" size="sm" fw={600} truncate className={classes.name}>
            {person.name}
          </Text>
          <Text component="span" size="xs" className={classes.count} id={countId}>
            {t("facesdashboard.numberoffaces", { count: person.faces.length, number: person.faces.length })}
          </Text>
        </span>
      </UnstyledButton>
    </div>
  );
}
