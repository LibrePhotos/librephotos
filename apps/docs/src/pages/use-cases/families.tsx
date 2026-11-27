import React, { type ReactNode } from "react";
import Link from "@docusaurus/Link";
import Since from "@site/src/components/Since";
import UseCasePage, { type UseCase } from "./_shared/UseCasePage";

const USE_CASE: UseCase = {
  slug: "families",
  pageTitle: "LibrePhotos for families",
  description:
    "How LibrePhotos serves a household: an account and library for each person, sharing albums, people and whole libraries, faces, events and memories, and what it does not do yet, such as phone backup.",
  title: "The family's photos in one place, on a computer at home.",
  lead: (
    <>
      Everyone gets their own account and their own library. You decide what to share with whom: an album, the
      photos of one person, or everything. Faces, places, events and memories are worked out on your own machine.
    </>
  ),
  hero: { kind: "app", id: "timeline" },
  problemsLead: (
    <>
      What families run into, and what LibrePhotos does about it. One thing first: LibrePhotos has no released phone
      app of its own yet. Read <a href="#not-yet">what it does not do yet</a> before you decide.
    </>
  ),
  problems: [
    {
      said: "Our photos are spread over four phones and two laptops.",
      title: "A library for each person, on one server",
      body: (
        <p>
          An admin creates an account for each person, each with their own folder, or lets LibrePhotos make a folder
          for every new user. Photos get in by drag and drop in the browser, or by any tool that copies them into
          that folder, and a scan on a schedule picks them up.
        </p>
      ),
      links: [
        { label: "Manage multiple users", to: "/docs/user-guide/managing-users" },
        { label: "Upload", to: "/docs/user-guide/upload" },
        { label: "Scan on a schedule", to: "/docs/user-guide/auto-scan#scan-on-a-schedule" },
      ],
    },
    {
      said: "I want my partner's photos of the kids in my timeline. Not their screenshots.",
      title: "Share a whole library, or one person",
      body: (
        <p>
          Share your library with your partner, choose what they see, and they can turn on{" "}
          <strong>Show in my timeline</strong>. Or share one Person, such as your child: the others see only the photos
          where you labelled that face and approved it for sharing.
        </p>
      ),
      links: [
        { label: "Sharing your whole library", to: "/docs/user-guide/sharing#sharing-your-whole-library" },
        { label: "Sharing a person", to: "/docs/user-guide/sharing#sharing-a-person" },
      ],
    },
    {
      said: "We both took photos at the birthday. Now they are in two places.",
      title: "Albums others can add to",
      body: (
        <p>
          Give someone <strong>Can add photos</strong> on an album and they add photos from their own library to it.
          Nothing is copied, every photo stays its owner&apos;s, and everyone in the album can comment and like.
        </p>
      ),
      links: [
        { label: "Albums others can add to", to: "/docs/user-guide/sharing#albums-others-can-add-to" },
        { label: "Comments and likes", to: "/docs/user-guide/sharing#comments-and-likes" },
      ],
    },
    {
      said: "Grandma does not want another account. She wants the pictures.",
      title: "Links, slideshows and QR codes",
      body: (
        <p>
          A public link to an album opens in any browser, with an expiry date if you like, and a slideshow link plays
          it full screen. <Since version="1.7.0" /> Every public link also gets a QR code to scan from the screen.
        </p>
      ),
      links: [
        { label: "Public links", to: "/docs/user-guide/sharing#public-album-sharing-via-link" },
        { label: "Slideshow link", to: "/docs/user-guide/sharing#slideshow-link" },
      ],
    },
    {
      said: "Where is the photo of Grandpa at the lake? It was years ago.",
      title: "Find people and places",
      body: (
        <p>
          Faces are grouped into people for you to name, and photos with a position get place names. Search by a
          person&apos;s name or a town. Searching by what is in a photo, such as &quot;dog in the snow&quot;, works once
          you turn on semantic search in your settings.
        </p>
      ),
      links: [
        { label: "Face recognition", to: "/docs/user-guide/face-recognition" },
        { label: "Search", to: "/docs/user-guide/search" },
        { label: "Turning on semantic search", to: "/docs/user-guide/search#enabling-semantic-search" },
      ],
    },
    {
      said: "We take thousands of photos and never look at them again.",
      title: "Memories, events and a yearly Rewind",
      body: (
        <p>
          The Memories strip above the timeline shows what you took on this day in earlier years. Events group a day
          out into an album named after when and where it happened. Around Christmas, each person can look back at
          their year in photos in <strong>Rewind</strong>.
        </p>
      ),
      links: [
        { label: "Memories", to: "/docs/user-guide/memories" },
        { label: "Events", to: "/docs/user-guide/albums#events" },
      ],
    },
    {
      said: "Everything we have is in Google Photos.",
      title: "Bring a Google Takeout export",
      body: (
        <p>
          Put the unzipped export in your folder. The scan reads the JSON files Google adds, so dates, locations and
          descriptions that only Google Photos knew come along.
        </p>
      ),
      links: [{ label: "Importing a Google Takeout export", to: "/docs/user-guide/google-takeout" }],
    },
    {
      said: "Some photos are nobody else's business.",
      title: "Private until you share",
      body: (
        <p>
          Every photo belongs to one person, and others only see what that person shares. <strong>Hidden</strong>{" "}
          takes a photo out of every view, and <strong>Archive</strong> takes it off the timeline and memories.
        </p>
      ),
      links: [
        { label: "Hidden", to: "/docs/user-guide/viewing-photos#hidden" },
        { label: "Archive", to: "/docs/user-guide/viewing-photos#archive" },
      ],
    },
  ],
  showcase: {
    eyebrow: "On a phone",
    title: "The web app works in the phone's browser",
    body: (
      <>
        <p>
          Until the official app is released, everyone in the family can open LibrePhotos in the browser of their
          phone or tablet. The layout adapts to the screen, with the main pages in a bar at the bottom.
        </p>
        <p>
          For backup from an Android phone, the third-party app UhuruPhotos can upload to LibrePhotos. It is in open
          beta on Google Play.
        </p>
      </>
    ),
    shot: { kind: "app", id: "timeline", phone: true },
    links: [{ label: "Mobile apps", to: "/docs/user-guide/mobile" }],
  },
  dayLead: "A Saturday in a household with one shared server.",
  day: [
    {
      when: "Morning",
      title: "Yesterday's photos are in",
      body: (
        <p>
          The photos copied from your phone last night are on the timeline: the hourly scan found them in your folder.
          The Memories strip shows the same weekend three years ago.
        </p>
      ),
    },
    {
      when: "Before lunch",
      title: "Approve the new photos for the grandparents",
      body: (
        <p>
          You confirm the face suggestions for your daughter. Her page says three new photos wait to be shared with the
          grandparents; you untick one and approve the rest.
        </p>
      ),
    },
    {
      when: "Afternoon",
      title: "One album for the birthday",
      body: (
        <p>
          Your partner adds their photos of the party to the album you made, and your brother leaves a comment on the
          cake.
        </p>
      ),
    },
    {
      when: "Evening",
      title: "Slideshow on the big screen",
      body: (
        <p>
          You open the album in the browser on the living-room computer and start the slideshow. Grandma gets the link
          by message and watches at home.
        </p>
      ),
    },
  ],
  gapsLead: "The limits a family is most likely to notice. Please read these before you move everyone over.",
  gaps: [
    {
      title: "No released phone app of its own",
      body: (
        <>
          The official LibrePhotos app for Android and iOS is not published yet. Automatic backup from a phone needs
          UhuruPhotos (Android, third party, beta) or a sync tool that copies into your folder. LibrePhotos has no
          iPhone app you can install today.
        </>
      ),
    },
    {
      title: "No library owned together",
      body: (
        <>
          Every photo has one owner. A shared library that several people change is not possible yet (
          <Link href="https://github.com/LibrePhotos/librephotos/issues/395">#395</Link>), and people someone shares
          with you cannot be added to your own People page (
          <Link href="https://github.com/LibrePhotos/librephotos/issues/632">#632</Link>).
        </>
      ),
    },
    {
      title: "Someone has to run the server",
      body: "LibrePhotos runs on a computer in your home or on a server you rent, and that person does the updates and the backups.",
    },
    {
      title: "No casting to a TV",
      body: "There is no Chromecast, AirPlay or TV app; a slideshow plays in a browser.",
    },
    {
      title: "No storage limits per person",
      body: "Every user can fill the disk; there are no quotas.",
    },
    {
      title: "No guest uploads or password links",
      body: "Adding photos needs an account, and public links cannot ask for a password.",
    },
  ],
  start: {
    lead: (
      <>
        <p>
          Install LibrePhotos on a computer that stays on, such as a NAS or a small home server, with Docker. The
          installation guide recommends 4 GB of memory.
        </p>
        <p>Then create an account for each person and give each one a folder.</p>
      </>
    ),
    actions: [
      { label: "Install LibrePhotos", to: "/docs/installation", filled: true },
      { label: "Manage multiple users", to: "/docs/user-guide/managing-users" },
      { label: "Sharing in a family", to: "/docs/user-guide/sharing#sharing-photos-in-a-family" },
    ],
    note: (
      <>
        The <Link to="/docs/user-guide/sharing#sharing-photos-in-a-family">family sharing guide</Link> compares five
        ways to set a household up.
      </>
    ),
  },
  faq: [
    {
      q: "Can two of us scan the same folder?",
      a: (
        <p>
          No. LibrePhotos refuses a scan directory that overlaps another user&apos;s. Use one family account for a
          shared folder, or share between personal libraries. See{" "}
          <Link to="/docs/user-guide/faq#can-two-users-share-one-photo-folder">the FAQ</Link>.
        </p>
      ),
    },
    {
      q: "Does it work on an iPhone?",
      a: (
        <p>
          In the browser, yes. LibrePhotos has no iPhone app to install yet, and UhuruPhotos is for Android only. Photos from
          an iPhone can reach LibrePhotos by upload in the browser or through a sync tool that copies them into your
          folder.
        </p>
      ),
    },
    {
      q: "Can I run it on the family PC with Windows?",
      a: (
        <p>
          There is a <Link to="/docs/installation/windows-standalone">Windows program</Link> that needs no Docker. It
          is meant for one person&apos;s library on their own PC; for a server the whole family shares, the guide
          recommends one of the Docker setups.
        </p>
      ),
    },
    {
      q: "Will the children see my private photos?",
      a: (
        <p>
          Only if you share them. Each person sees their own library and what others shared with them. If everyone
          signs in with one shared login instead, everyone sees everything.
        </p>
      ),
    },
    {
      q: "What does it cost?",
      a: (
        <p>
          Nothing. LibrePhotos is open source under the MIT license, with no paid tier. You pay for the computer and the
          disks it runs on.
        </p>
      ),
    },
  ],
};

export default function Families(): ReactNode {
  return <UseCasePage useCase={USE_CASE} />;
}
