import { Avatar } from "@mantine/core";
import React from "react";
import type { Person } from "../../api_client/albums/hooks";

/**
 * The person page's face, before the name in its header (PageHeader's `leading`), as Immich and
 * Google Photos show a person: a 56px circle of their cover face, or their initials without one.
 * The name is right next to it, so the picture says nothing more.
 */
export function PersonHeaderAvatar({ person }: Readonly<{ person: Pick<Person, "name" | "face_url"> }>) {
  return <Avatar size={56} radius="xl" src={person.face_url || null} name={person.name} color="initials" alt="" />;
}
