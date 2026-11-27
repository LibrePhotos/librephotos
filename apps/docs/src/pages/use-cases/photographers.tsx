import React, { type ReactNode } from "react";
import Link from "@docusaurus/Link";
import useBaseUrl from "@docusaurus/useBaseUrl";
import Since from "@site/src/components/Since";
import UseCasePage, { type UseCase } from "./_shared/UseCasePage";

function ViewerLink({ children }: { children: ReactNode }): ReactNode {
  return <a href={useBaseUrl("/viewer")}>{children}</a>;
}

const USE_CASE: UseCase = {
  slug: "photographers",
  pageTitle: "LibrePhotos for photographers",
  description:
    "How LibrePhotos serves hobby and semi-pro photographers: RAW+JPEG pairs, star ratings, XMP sidecars shared with digiKam, darktable and Lightroom, exposure search, and what it does not do yet.",
  title: "Your RAW files, ratings and sidecars, on a server you run.",
  lead: (
    <>
      LibrePhotos indexes the folders your memory cards end up in. A RAW+JPEG pair stays one photo, the ratings and
      keywords you gave in digiKam, darktable or Lightroom come along from the XMP sidecars, and the changes you make
      in LibrePhotos can be written back to them.
    </>
  ),
  hero: { kind: "app", id: "lightbox" },
  problemsLead: (
    <>
      Typical problems, put the way photographers put them, and what LibrePhotos does about each one. Every answer
      links to the page of the user guide that explains it in full.
    </>
  ),
  problems: [
    {
      said: "I shoot RAW+JPEG, and other apps show me every shot twice.",
      title: "One photo per shot, with its RAW file",
      body: (
        <p>
          When a RAW file and a JPEG have the same name in the same folder, such as <code>IMG_001.CR2</code> and{" "}
          <code>IMG_001.jpg</code>, the scan makes them one photo with a <strong>RAW</strong> badge. Both files stay in
          your library, and a download of the photo includes every one of its files. The search filter{" "}
          <strong>Has a RAW file</strong> finds them.
        </p>
      ),
      links: [
        { label: "RAW+JPEG pairs", to: "/docs/user-guide/stacks-and-file-variants#rawjpeg-pairs" },
        { label: "Search filters", to: "/docs/user-guide/search#search-filters" },
      ],
    },
    {
      said: "My ratings and keywords live in digiKam. I am not doing them again.",
      title: "Sidecars are read, in both naming styles",
      body: (
        <p>
          A scan reads <code>IMG_2.xmp</code> (Lightroom) and <code>IMG_2.jpg.xmp</code> (digiKam, darktable), and the
          sidecar of a photo&apos;s RAW file, such as <code>IMG_2.CR2.xmp</code>. Ratings, keywords, captions, the
          date, the position and named face regions in those sidecars reach the photo. Each keyword becomes a Tag.
        </p>
      ),
      links: [
        { label: "Which sidecars are read", to: "/docs/user-guide/exif-data#which-sidecars-are-read" },
        { label: "What LibrePhotos reads", to: "/docs/user-guide/exif-data#what-librephotos-reads" },
      ],
    },
    {
      said: "When I change something in the browser, darktable should see it too.",
      title: "Edits written back to the sidecar, if you choose",
      body: (
        <p>
          Set <strong>Write edits to files</strong> to <strong>Save to sidecar</strong> and a rating, date, rotation,
          caption, location, Tag or copyright you change is written to the sidecar that already exists, which keeps the
          other app&apos;s tags. With <strong>Write face tags to image files</strong> the named faces go there as well.
          It is off by default: until you switch it on, LibrePhotos never writes to your files.
        </p>
      ),
      links: [
        { label: "What LibrePhotos writes", to: "/docs/user-guide/exif-data#what-librephotos-writes" },
        { label: "Which sidecar is written", to: "/docs/user-guide/exif-data#which-sidecar-is-written" },
      ],
    },
    {
      said: "I cull with star ratings, not with a single heart.",
      title: "Rate with one to five stars",
      body: (
        <p>
          Set <strong>Rating style</strong> to <strong>Stars</strong>. In the photo viewer the keys <code>1</code> to{" "}
          <code>5</code> set the rating and <code>0</code> clears it, and the grid shows each photo&apos;s stars. It is
          the same 0 to 5 rating that is read from and written to the file&apos;s metadata.
        </p>
      ),
      links: [{ label: "Rating photos with stars", to: "/docs/user-guide/viewing-photos#rating-photos-with-stars" }],
    },
    {
      said: "I want every shot I took with the 50 mm at f/1.8.",
      title: "Search by camera, lens and exposure",
      body: (
        <p>
          The search filters narrow results by camera maker, camera and lens, by ISO, aperture and focal length, by
          rating and by the day it was taken. <strong>All metadata</strong> in the photo viewer lists every tag
          ExifTool finds in the file and its sidecars, maker notes included.
        </p>
      ),
      links: [
        { label: "Search filters", to: "/docs/user-guide/search#search-filters" },
        { label: "All metadata", to: "/docs/user-guide/exif-data#all-metadata" },
      ],
    },
    {
      said: "Bursts and near copies bury the good frames.",
      title: "Stacks and duplicates",
      body: (
        <p>
          Burst sequences are found from the file names, the capture times and the camera&apos;s burst tags, and shown
          as one Stack. Duplicate detection finds exact copies and visually similar photos, and lets you review each
          group before anything goes to the trash.
        </p>
      ),
      links: [
        { label: "Stacks", to: "/docs/user-guide/stacks-and-file-variants#stacks" },
        { label: "Duplicate detection", to: "/docs/user-guide/duplicate-detection" },
      ],
    },
    {
      said: "I only want to straighten a horizon, not start the RAW editor.",
      title: "A photo editor that keeps the original",
      since: "1.7.0",
      body: (
        <p>
          The built-in editor crops, straightens and adjusts light and colour, and has filters. A RAW file on its own
          is developed by the server from its RAW data. The edit is stored as settings next to the photo, so your file
          is never changed and you can revert at any time.
        </p>
      ),
      links: [
        { label: "Editing photos", to: "/docs/user-guide/editing-photos" },
        { label: "RAW files in the editor", to: "/docs/user-guide/editing-photos#raw-files" },
      ],
    },
    {
      said: "When I show my work, people should know how they may use it.",
      title: "Copyright, creator and license",
      body: (
        <p>
          Give a photo, a selection or all your new photos a copyright notice, a creator and a license such as CC BY 4.0.
          They are read from the standard XMP, IPTC and EXIF fields, written back when write-back is on, and shown on
          public pages. Albums can be shared through a link that expires, and when an admin turns the public gallery
          on, you can choose to show your public photos there.
        </p>
      ),
      links: [
        { label: "Copyright and licenses", to: "/docs/user-guide/rights" },
        { label: "Public links", to: "/docs/user-guide/sharing#public-album-sharing-via-link" },
      ],
    },
  ],
  showcase: {
    eyebrow: "Desktop app, preview",
    title: "LibrePhotos Viewer on your computer",
    since: "1.7.0",
    body: (
      <>
        <p>
          The desktop app opens JPEG, HEIC, AVIF, JPEG XL and camera RAW files from Explorer or Finder, and lets you
          rate, caption and keyword them. It saves those changes in an XMP sidecar next to the picture by default, so
          digiKam, darktable and the LibrePhotos server see them too. It works without a server, and when you sign in
          it can back up your folders to it.
        </p>
        <p>
          It is a preview for Windows and macOS that has not been released yet. Read more on the{" "}
          <ViewerLink>LibrePhotos Viewer page</ViewerLink>.
        </p>
      </>
    ),
    shot: {
      kind: "file",
      src: "/img/use-cases/viewer-raw-photo.webp",
      alt: "LibrePhotos Viewer showing a Nikon NEF RAW photo of a mountain road, with its Info panel: caption, five stars, the camera, lens and exposure, and a note that the edits are in an XMP sidecar next to the photo",
      width: 1600,
      height: 900,
      caption: "A RAW file open in the desktop app, with its rating and caption saved in the sidecar.",
    },
    links: [
      { label: "Desktop app", to: "/docs/user-guide/desktop" },
      { label: "Where edits are saved", to: "/docs/user-guide/desktop/editing#where-edits-are-saved" },
    ],
  },
  dayLead: "One way an evening after a shoot can go. Every step is something the app does today, unless marked.",
  day: [
    {
      when: "Evening",
      title: "Copy the card",
      body: (
        <p>
          You copy the memory card into a dated folder in your photo library, as you always have. With{" "}
          <strong>Scan libraries automatically</strong> set to <strong>Every hour</strong>, the new shots appear on the
          timeline without a click, each RAW+JPEG pair as one photo.
        </p>
      ),
    },
    {
      when: "Culling",
      title: "Rate with the keyboard",
      body: (
        <p>
          You open the first photo and move through the shoot with the arrow keys, pressing <code>1</code> to{" "}
          <code>5</code>. Bursts sit in Stacks, so you look at one frame per sequence.
        </p>
      ),
    },
    {
      when: "Back in darktable",
      title: "The ratings are already there",
      body: (
        <p>
          With <strong>Save to sidecar</strong> on, your ratings are in the sidecars, so darktable shows the same stars
          when you open the folder to develop the keepers.
        </p>
      ),
    },
    {
      when: "Later",
      title: "Compare lenses",
      body: (
        <p>
          A search with the lens filter and an aperture range lists every shot with that lens wide open, across years
          of folders.
        </p>
      ),
    },
    {
      when: "Before bed",
      title: "Share the best",
      body: (
        <p>
          You put the five-star shots into an album, set a CC BY-NC 4.0 license on them, and send a public link that
          expires in 30 days.
        </p>
      ),
    },
  ],
  gapsLead: "Better you hear it here than find out after the first scan.",
  gaps: [
    {
      title: "No colour labels or pick and reject flags",
      body: "Photos have a rating and a favourite, nothing else. Colour labels from other tools are not read.",
    },
    {
      title: "Keyword hierarchies are flattened",
      body: (
        <>
          Of a hierarchical keyword only the last level becomes a Tag, so <code>Places|USA|San Francisco</code> adds{" "}
          <code>San Francisco</code>. <code>HierarchicalSubject</code> is never written.
        </>
      ),
    },
    {
      title: "Write-back needs write access",
      body: "It is off by default, and a library mounted read-only cannot be written to: the edits then stay in LibrePhotos.",
    },
    {
      title: "The editor is not a RAW developer",
      body: (
        <>
          <Since version="1.7.0" /> No brushes, masks or healing, no lens corrections or camera profiles, and no video
          editing. A RAW+JPEG pair is edited from its JPEG.
        </>
      ),
    },
    {
      title: "No GPX geotagging",
      body: "GPX track files are not imported. Geotag in another tool first; the next scan reads the new position.",
    },
    {
      title: "No password-protected links",
      body: "Public links can expire, but they cannot ask for a password.",
    },
  ],
  start: {
    lead: (
      <>
        <p>
          Install the server on the machine that holds your photos and point it at your photo folder. The first scan
          only reads.
        </p>
        <p>
          For the desktop app, see the <ViewerLink>LibrePhotos Viewer page</ViewerLink> once it is released.
        </p>
      </>
    ),
    actions: [
      { label: "Install LibrePhotos", to: "/docs/installation", filled: true },
      { label: "First steps", to: "/docs/user-guide/first-steps" },
      { label: "LibrePhotos Viewer", to: "/viewer", plainHref: true },
    ],
    note: (
      <>
        Then set <strong>Write edits to files</strong> in{" "}
        <Link to="/docs/user-guide/settings#metadata-options">Settings</Link> if you want your changes in the sidecars.
      </>
    ),
  },
  faq: [
    {
      q: "Does LibrePhotos change my RAW files?",
      a: (
        <p>
          Not unless you ask it to. With <strong>Write edits to files</strong> on <strong>Off</strong>, the default, it
          never writes to your files, and a scan only reads. <strong>Save to sidecar</strong> writes only to the
          sidecar. The photo editor never writes to the file either.
        </p>
      ),
    },
    {
      q: "Which sidecar does it write to?",
      a: (
        <p>
          The one the photo already has, updated in place. When there is none it creates <code>IMG_2.jpg.xmp</code>.
          The sidecar of a RAW file next to a JPEG is read but not written; the edit goes to the sidecar of the JPEG.
          See <Link to="/docs/user-guide/exif-data#which-sidecar-is-written">Which sidecar is written</Link>.
        </p>
      ),
    },
    {
      q: "Does it read the face names I set in digiKam?",
      a: (
        <p>
          Yes. Face regions in the MWG format (<code>XMP-mwg-rs:RegionInfo</code>) with a name become Faces of the
          Person with that name, and LibrePhotos&apos; own face detection runs as well.
        </p>
      ),
    },
    {
      q: "What about a RAW file that is in another folder than its JPEG?",
      a: <p>It becomes a photo of its own. Pairs are only made from files with the same name in the same folder.</p>,
    },
    {
      q: "Does a download keep my edits?",
      a: (
        <p>
          A zip download holds the XMP sidecars next to their files, including the ones LibrePhotos wrote. See{" "}
          <Link to="/docs/user-guide/exif-data#sidecars-in-a-download">Sidecars in a download</Link>.
        </p>
      ),
    },
    {
      q: "Does it replace Lightroom or darktable?",
      a: (
        <p>
          No. LibrePhotos is a library you browse, search and share from a browser. Keep developing in the tool you use;
          LibrePhotos reads what it writes to the sidecars.
        </p>
      ),
    },
  ],
};

export default function Photographers(): ReactNode {
  return <UseCasePage useCase={USE_CASE} />;
}
