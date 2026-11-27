import React, { type ReactNode } from "react";

export type GroupSlug = "photographers" | "archivists" | "families" | "self-hosters";

export type Group = {
  slug: GroupSlug;
  name: string;
  summary: string;
  points: string[];
  icon: ReactNode;
};

export function Icon({ children }: { children: ReactNode }): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function ChevronIcon({ className }: { className?: string }): ReactNode {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export const GROUPS: Group[] = [
  {
    slug: "photographers",
    name: "Photographers",
    summary:
      "Hobby and semi-pro photographers who shoot RAW, rate and keyword in digiKam, darktable or Lightroom, and want the library on a server of their own.",
    points: [
      "RAW+JPEG pairs shown as one photo",
      "Ratings, keywords and captions read from XMP sidecars, and written back if you choose",
      "Search by camera, lens, aperture, ISO and focal length",
    ],
    icon: (
      <Icon>
        <path d="M5 7h1a2 2 0 0 0 2-2 1 1 0 0 1 1-1h6a1 1 0 0 1 1 1 2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2" />
        <path d="M9 13a3 3 0 1 0 6 0 3 3 0 0 0-6 0" />
      </Icon>
    ),
  },
  {
    slug: "archivists",
    name: "Archivists and family historians",
    summary:
      "People who keep a family archive, a local history collection or a club's photos, and need the files to stay where they are and the knowledge to stay in the files.",
    points: [
      "Folders indexed in place, nothing reorganised",
      "Dates, captions, locations, rights and named faces in standard XMP",
      "Faces, places and the text on scanned documents made searchable",
    ],
    icon: (
      <Icon>
        <path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 12h4" />
      </Icon>
    ),
  },
  {
    slug: "families",
    name: "Families",
    summary:
      "Households that want one place for everyone's photos at home, with an account for each person and sharing they decide on themselves.",
    points: [
      "An account and a library for each person",
      "Share an album, a person or a whole library with each other",
      "Faces, places, events and memories made for you",
    ],
    icon: (
      <Icon>
        <path d="M5 7a4 4 0 1 0 8 0 4 4 0 1 0-8 0M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0-3-3.85" />
      </Icon>
    ),
  },
  {
    slug: "self-hosters",
    name: "Self-hosters and homelab users",
    summary:
      "People who run their own services and want a photo server that keeps photos, faces and search on their own hardware.",
    points: [
      "Machine learning runs on your server, place names offline by default",
      "Docker, Kubernetes, Unraid or a Windows program; SQLite or PostgreSQL",
      "Single sign-on with OpenID Connect, a REST API and management commands",
    ],
    icon: (
      <Icon>
        <path d="M3 7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" />
        <path d="M3 15a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM7 8v.01M7 16v.01" />
      </Icon>
    ),
  },
];

export function groupBySlug(slug: GroupSlug): Group {
  const group = GROUPS.find((g) => g.slug === slug);
  if (!group) {
    throw new Error(`Unknown use case: ${slug}`);
  }
  return group;
}
