import { ActionIcon, Menu, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconDotsVertical } from "@tabler/icons-react";
import clsx from "clsx";
import React, { useRef } from "react";
import type { ReactNode } from "react";
import { Tile } from "../Tile";
import classes from "./CollectionCard.module.css";
import { useLongPress } from "./useLongPress";

/** A cover photo as the album lists send it. */
type CollectionCover = Readonly<{ image_hash: string; video?: boolean | null }>;

/** What the card hands its link: spread it on a router Link, so the route stays typed. */
type CollectionCardLinkProps = Readonly<{
  className: string | undefined;
  "aria-label": string;
  children: ReactNode;
}>;

type Props = Readonly<{
  title: string;
  /** The dimmed line under the title: a count, or a date and a count. */
  meta?: string;
  /** The link around the picture and its text. Left out, the card opens nothing. */
  renderLink?: (props: CollectionCardLinkProps) => ReactNode;
  /** The link's name; the title by default. */
  linkLabel?: string;
  /** One cover, or up to three side by side. None shows `placeholder`. */
  covers?: readonly CollectionCover[];
  /** Drawn instead of the covers (a face crop, a map). Give it `collectionCardImageClass`. */
  media?: ReactNode;
  /** The icon on an empty card. */
  placeholder?: ReactNode;
  /** The card's width in px, for the cover images' size attributes. */
  size: number;
  /** Square by default; portrait (3:4) for people, wide (4:3) for the hub's category cards. */
  shape?: "square" | "portrait" | "wide";
  /** Small white glyphs in the top-left corner. */
  badges?: ReactNode;
  /** The ⋮ menu's items; no menu without them. */
  menuItems?: ReactNode;
  /** The ⋮ button's name; the title by default. */
  menuLabel?: string;
  /** Called with the ⋮ button when it is clicked, for a dialog that hands focus back to it. */
  onMenuOpen?: (trigger: HTMLButtonElement) => void;
  className?: string;
}>;

/** The class that makes a `media` element fill the card like a cover. */
export const collectionCardImageClass = classes.image;

function Covers({ covers, size }: Readonly<{ covers: readonly CollectionCover[]; size: number }>) {
  // A collage shows each photo once
  const shown = [...new Map(covers.map(cover => [cover.image_hash, cover])).values()].slice(0, 3);
  const width = Math.round(size / shown.length);
  return shown.map(cover => (
    <Tile
      key={cover.image_hash}
      className={classes.image}
      video={cover.video === true}
      width={width}
      height={size}
      image_hash={cover.image_hash}
    />
  ));
}

type CardMenuProps = Readonly<{
  label: string;
  opened: boolean;
  onToggle: (trigger: HTMLButtonElement) => void;
  onClose: () => void;
  trigger: React.RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}>;

/** The card's ⋮ menu. On a phone its button hides and a long press on the card opens it. */
function CardMenu({ label, opened, onToggle, onClose, trigger, children }: CardMenuProps) {
  return (
    <div className={classes.menu}>
      {/* Its items open dialogs: handing focus back to the trigger took it from the dialog's
          input. Escape still returns it (Mantine does that on its own). A long press opens it
          with the finger still down, so only a new press outside closes it, not that one's
          release. */}
      <Menu
        position="bottom-end"
        returnFocus={false}
        opened={opened}
        onClose={onClose}
        clickOutsideEvents={["pointerdown"]}
      >
        <Menu.Target>
          <ActionIcon
            ref={trigger}
            variant="transparent"
            className={classes.menuButton}
            aria-label={label}
            onClick={event => {
              event.preventDefault();
              onToggle(event.currentTarget);
            }}
          >
            <IconDotsVertical size={16} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>{children}</Menu.Dropdown>
      </Menu>
    </div>
  );
}

/**
 * One card for every collection grid and row (albums, events, things, tags, places, folders, shared
 * albums, people): the cover fills a rounded box and the title and count sit on it bottom-left, over
 * a soft gradient. The ⋮ menu shows on hover and focus only (quietly always on touch screens); on
 * a phone it hides and a long press on the card opens the same menu (review r6 #16).
 */
export function CollectionCard({
  title,
  meta,
  renderLink,
  linkLabel,
  covers = [],
  media,
  placeholder,
  size,
  shape = "square",
  badges,
  menuItems,
  menuLabel,
  onMenuOpen,
  className,
}: Props) {
  const picture =
    media ??
    (covers.length > 0 ? (
      <Covers covers={covers} size={size} />
    ) : (
      <div className={clsx(classes.image, classes.placeholder)}>{placeholder}</div>
    ));
  const [menuOpened, menu] = useDisclosure(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const longPress = useLongPress(() => {
    menu.open();
    if (trigger.current) onMenuOpen?.(trigger.current);
  });
  const content = (
    <>
      <div className={classes.media}>{picture}</div>
      <div className={classes.scrim} />
      <div className={classes.caption}>
        <Text component="p" className={classes.title} lineClamp={2} title={title}>
          {title}
        </Text>
        {meta ? (
          <Text component="p" className={classes.meta} lineClamp={1}>
            {meta}
          </Text>
        ) : null}
      </div>
    </>
  );

  return (
    <div className={clsx(classes.card, className)} data-shape={shape} {...(menuItems ? longPress : {})}>
      {renderLink ? (
        renderLink({ className: classes.frame, "aria-label": linkLabel ?? title, children: content })
      ) : (
        <div className={classes.frame}>{content}</div>
      )}
      {badges ? <div className={classes.badges}>{badges}</div> : null}
      {menuItems ? (
        <CardMenu
          label={menuLabel ?? title}
          opened={menuOpened}
          onToggle={button => {
            if (!menuOpened) onMenuOpen?.(button);
            menu.toggle();
          }}
          onClose={menu.close}
          trigger={trigger}
        >
          {menuItems}
        </CardMenu>
      ) : null}
    </div>
  );
}
