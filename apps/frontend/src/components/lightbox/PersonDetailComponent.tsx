import type { PhotoPerson } from "@librephotos/api-client";
import { ActionIcon, Avatar, Badge, Button, Group, Indicator, Text, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconEdit, IconTrash, IconUserCheck, IconUserOff, IconUserQuestion } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useDeleteFacesMutation, useSetFacesPersonLabelMutation } from "../../api_client/faces";
import { serverAddress } from "../../api_client/urls";
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

/** A small grey icon button of a face row, with its tooltip. */
function FaceAction({
  tooltip,
  label,
  onClick,
  children,
}: Readonly<{ tooltip: string; label: string; onClick: () => void; children: React.ReactNode }>) {
  return (
    <Tooltip label={tooltip}>
      <ActionIcon variant="subtle" color="gray" size="sm" aria-label={label} onClick={onClick}>
        {children}
      </ActionIcon>
    </Tooltip>
  );
}

/** Confirm the guess, name or rename, not this person, delete: what the owner can do with a face. */
function FaceActions({
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
    <>
      {!isUnnamed && !isClusterLabel && person.type !== "user" && (
        <FaceAction
          tooltip={t("facesdashboard.explanationadding")}
          label={t("facesdashboard.confirmface", { name: person.name })}
          onClick={onConfirm}
        >
          <IconUserCheck size={FACE_ACTION_ICON} />
        </FaceAction>
      )}
      <FaceAction
        tooltip={isUnnamed ? t("lightbox.sidebar.nameface") : t("facesdashboard.explanationadding")}
        label={isUnnamed ? t("lightbox.sidebar.nameface") : t("facesdashboard.labelas")}
        onClick={onRename}
      >
        {isUnnamed ? <IconUserQuestion size={FACE_ACTION_ICON} /> : <IconEdit size={FACE_ACTION_ICON} />}
      </FaceAction>
      {!isUnnamed && (
        <FaceAction
          tooltip={t("facesdashboard.notthisperson")}
          label={t("facesdashboard.notperson", { name: person.name })}
          onClick={onNotThisPerson}
        >
          <IconUserOff size={FACE_ACTION_ICON} />
        </FaceAction>
      )}
      {person.type !== "user" && (
        <FaceAction
          tooltip={t("facesdashboard.explanationdeleting")}
          label={t("facesdashboard.deleteface")}
          onClick={onDelete}
        >
          <IconTrash size={FACE_ACTION_ICON} />
        </FaceAction>
      )}
    </>
  );
}

const FACE_ACTION_ICON = 16;

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
        {/* The name is right next to it */}
        <Avatar radius="xl" src={`${serverAddress}${person.face_url}`} alt="" />
      </Indicator>
    </FaceTooltip>
  );

  const label = (
    <Text
      size="sm"
      truncate
      title={isUnnamed ? undefined : person.name}
      c={isUnnamed ? "dimmed" : undefined}
      fs={isUnnamed ? "italic" : undefined}
    >
      {isUnnamed ? t("lightbox.sidebar.unnamedface") : person.name}
    </Text>
  );

  return (
    // One row per face: a long name is cut short rather than pushing the
    // actions onto a line of their own.
    <Group
      align="center"
      gap="xs"
      wrap="nowrap"
      maw="100%"
      className={classes.faceRow}
      onMouseEnter={() => setFaceLocation(person.location)}
      onMouseLeave={() => setFaceLocation(null)}
    >
      {isPublic ? (
        // Search needs a login, so a public page's names are just labels, laid
        // out like the button below (its padding and section gap).
        <Group gap="xs" wrap="nowrap" miw={0} p={3}>
          {face}
          {label}
        </Group>
      ) : (
        <Button
          variant="subtle"
          color="gray"
          fw={400}
          h="auto"
          p={3}
          miw={0}
          leftSection={face}
          // An unnamed face has no person album and no search term to navigate to,
          // so the whole row is the affordance for naming it instead.
          onClick={() => {
            if (isUnnamed) {
              openPersonPicker();
            } else {
              navigate({ to: `/search/${encodeURIComponent(person.name)}` });
            }
          }}
        >
          {label}
        </Button>
      )}
      {isNew && (
        <Badge size="xs" color="green" variant="light" miw="auto">
          {t("lightbox.detectfaces.new")}
        </Badge>
      )}
      {typeof person.video_time === "number" && <VideoTimeButton seconds={person.video_time} name={person.name} />}
      {!isPublic && (
        // Neutral and quiet until the row is pointed at: the faces and names are what the panel shows.
        <div className={classes.faceActions}>
          <FaceActions
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
    </Group>
  );
}
