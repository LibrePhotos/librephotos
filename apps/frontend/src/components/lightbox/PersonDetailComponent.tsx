import type { PhotoPerson } from "@librephotos/api-client";
import { ActionIcon, Avatar, Badge, Indicator, Menu, Text, UnstyledButton } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconDotsVertical,
  IconEdit,
  IconTrash,
  IconUserCheck,
  IconUserOff,
  IconUserQuestion,
} from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useDeleteFacesMutation, useSetFacesPersonLabelMutation } from "../../api_client/faces";
import { serverAddress } from "../../api_client/urls";
import { ICON_SIZE } from "../../uiConstants";
import { calculateProbabiltyColor } from "../facedashboard/FaceComponent";
import { FaceTooltip } from "../facedashboard/FaceTooltip";
import { ConfirmModal } from "../modals/ConfirmModal";
import type { FaceLocationType } from "./lightbox.types";
import classes from "./Sidebar.module.css";
import { VideoTimeButton } from "./VideoTimeButton";

type Props = {
  /** One face on the photo, as the photo detail lists it. */
  person: PhotoPerson;
  isPublic: boolean;
  setFaceLocation: (location: FaceLocationType) => void;
  onPersonEdit: (faceId: number, faceUrl: string) => void;
  notThisPerson: (faceId: number) => void;
  /** Found by the Detect faces again just run on this photo (#1117). */
  isNew?: boolean;
};

type FaceActionsProps = Readonly<{
  person: PhotoPerson;
  isUnnamed: boolean;
  isClusterLabel: boolean;
  onConfirm: () => void;
  onRename: () => void;
  onNotThisPerson: () => void;
  onDelete: () => void;
}>;

/**
 * Confirm the guess, name or rename, not this person, delete: what the owner can do with a face, in
 * its ⋮ menu, each item saying what it does.
 */
function FaceActionsMenu({
  person,
  isUnnamed,
  isClusterLabel,
  onConfirm,
  onRename,
  onNotThisPerson,
  onDelete,
}: FaceActionsProps) {
  const { t } = useTranslation();
  return (
    // In the panel, not a portal: it stays in the viewer's dark scope.
    <Menu position="bottom-end" withinPortal={false} width={220}>
      <Menu.Target>
        <ActionIcon
          variant="transparent"
          size="sm"
          radius="xl"
          className={classes.faceMenuButton}
          aria-label={
            isUnnamed
              ? t("lightbox.sidebar.faceactionsunnamed")
              : t("lightbox.sidebar.faceactions", { name: person.name })
          }
        >
          <IconDotsVertical size={FACE_ACTION_ICON} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {!isUnnamed && !isClusterLabel && person.type !== "user" && (
          <Menu.Item leftSection={<IconUserCheck size={ICON_SIZE.menu} />} onClick={onConfirm}>
            {t("facesdashboard.confirmface", { name: person.name })}
          </Menu.Item>
        )}
        <Menu.Item
          leftSection={isUnnamed ? <IconUserQuestion size={ICON_SIZE.menu} /> : <IconEdit size={ICON_SIZE.menu} />}
          onClick={onRename}
        >
          {isUnnamed ? t("lightbox.sidebar.nameface") : t("facesdashboard.labelas")}
        </Menu.Item>
        {!isUnnamed && (
          <Menu.Item leftSection={<IconUserOff size={ICON_SIZE.menu} />} onClick={onNotThisPerson}>
            {t("facesdashboard.notperson", { name: person.name })}
          </Menu.Item>
        )}
        {person.type !== "user" && (
          <Menu.Item color="red" leftSection={<IconTrash size={ICON_SIZE.menu} />} onClick={onDelete}>
            {t("facesdashboard.deleteface")}
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

const FACE_ACTION_ICON = 14;
/** The face crop: a rounded square, as Immich shows the faces of a photo. */
const FACE_SIZE = 64;

export function PersonDetail({ person, isPublic, setFaceLocation, onPersonEdit, notThisPerson, isNew = false }: Props) {
  const { t } = useTranslation();
  const [tooltipOpened, { open: openTooltip, close: closeTooltip }] = useDisclosure(false);
  const { mutate: setFacesPersonLabel } = useSetFacesPersonLabelMutation();
  const { mutate: deleteFaces, isPending: isDeleting } = useDeleteFacesMutation();
  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure(false);
  const navigate = useNavigate();

  // A face nobody has named yet, and that neither clustering nor classification
  // guessed a name for. It still belongs in this list -- it is the only place
  // where a face the algorithms gave up on can be named -- but it has no name to
  // show, no confidence to explain, and nothing to confirm or reject.
  const isUnnamed = !person.name;

  // A cluster row's label is the cluster's own name -- clustering calls every
  // unnamed cluster "Unknown 001" and so on -- not the name of whoever is in the
  // photo. Confirming it asks the backend for a *person* by that name, which is
  // not a person anyone has. The face dashboard has always hidden confirm for
  // CLUSTER and UNKNOWN kinds; this is the same row seen from the photo.
  const isClusterLabel = person.type === "cluster";

  const openPersonPicker = () => onPersonEdit(person.face_id, person.face_url);

  // The hook says "deleted" once the server confirmed; the dialog closes then too.
  const deleteFace = () => deleteFaces({ faceIds: [person.face_id] }, { onSuccess: closeDelete });

  const face = (
    <FaceTooltip tooltipOpened={tooltipOpened} probability={person.probability}>
      <Indicator
        color={calculateProbabiltyColor(person.probability)}
        disabled={person.type === "user" || isUnnamed}
        onMouseEnter={() => person.type !== "user" && !isUnnamed && openTooltip()}
        onMouseLeave={() => closeTooltip()}
        size={12}
        offset={4}
      >
        {/* The name is right under it */}
        <Avatar size={FACE_SIZE} radius={12} src={`${serverAddress}${person.face_url}`} alt="" />
      </Indicator>
    </FaceTooltip>
  );

  const label = (
    <Text
      className={classes.faceName}
      title={isUnnamed ? undefined : person.name}
      c={isUnnamed ? "dimmed" : undefined}
      fs={isUnnamed ? "italic" : undefined}
    >
      {isUnnamed ? t("lightbox.sidebar.unnamedface") : person.name}
    </Text>
  );

  return (
    // One tile per face: the crop with its name under it, the actions in a ⋮ on the crop's corner
    // that shows on hover or focus (always on a touch screen).
    <div
      className={classes.faceTile}
      onMouseEnter={() => setFaceLocation(person.location)}
      onMouseLeave={() => setFaceLocation(null)}
    >
      {isPublic ? (
        // Search needs a login, so a public page's names are just labels, laid out like the button.
        <div className={classes.faceButton}>
          {face}
          {label}
        </div>
      ) : (
        <UnstyledButton
          className={classes.faceButton}
          // An unnamed face has no person album and no search term to navigate to,
          // so the whole tile is the affordance for naming it instead.
          onClick={() => {
            if (isUnnamed) {
              openPersonPicker();
            } else {
              void navigate({ to: `/search/${encodeURIComponent(person.name)}` });
            }
          }}
        >
          {face}
          {label}
        </UnstyledButton>
      )}
      {isNew && (
        <Badge size="xs" color="green" variant="filled" className={classes.faceNew}>
          {t("lightbox.detectfaces.new")}
        </Badge>
      )}
      {typeof person.video_time === "number" && <VideoTimeButton seconds={person.video_time} name={person.name} />}
      {!isPublic && (
        // Neutral and quiet until the tile is pointed at: the faces and names are what the panel shows.
        <div className={classes.faceActions}>
          <FaceActionsMenu
            person={person}
            isUnnamed={isUnnamed}
            isClusterLabel={isClusterLabel}
            onConfirm={() => setFacesPersonLabel({ faceIds: [person.face_id], personName: person.name })}
            onRename={openPersonPicker}
            onNotThisPerson={() => notThisPerson(person.face_id)}
            onDelete={openDelete}
          />
        </div>
      )}
      <ConfirmModal
        opened={deleteOpened}
        onClose={closeDelete}
        onConfirm={deleteFace}
        loading={isDeleting}
        title={t("confirmdialog.deleteface.title")}
        // A deleted face can be restored from the Deleted tab of the Faces page (#127)
        message={`${
          isUnnamed
            ? t("confirmdialog.deleteface.messageunnamed")
            : t("confirmdialog.deleteface.message", { name: person.name })
        } ${t("confirmdialog.deleteface.restorable")}`}
        confirmLabel={t("confirmdialog.deleteface.confirm")}
      />
    </div>
  );
}
