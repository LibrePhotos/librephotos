import React, { type ReactNode } from "react";
import Link from "@docusaurus/Link";
import UseCasePage, { type UseCase } from "./_shared/UseCasePage";

const USE_CASE: UseCase = {
  slug: "archivists",
  pageTitle: "LibrePhotos for archivists and family historians",
  description:
    "How LibrePhotos serves family archives, local history collections and club archives: files indexed in place, dates, captions, rights and faces in standard XMP, text recognition, and what it does not do yet.",
  title: "An archive that stays in your folders and in open formats.",
  lead: (
    <>
      For a family archive, a local history collection or the photos of a club. LibrePhotos indexes the folders you
      already keep, makes them searchable by people, places, dates and the text on them, and can write what you
      learn about each photo into standard XMP next to the file.
    </>
  ),
  hero: { kind: "app", id: "albums" },
  problemsLead: (
    <>
      The questions collections raise, and how LibrePhotos answers each one. Every answer links to the page of the
      user guide that explains it in full.
    </>
  ),
  problems: [
    {
      said: "The folder structure is the archive. No program gets to rearrange it.",
      title: "Indexed in place, browsed by folder",
      body: (
        <p>
          A scan reads your folders and never moves, renames or rewrites a file. The <strong>Folders</strong> view
          shows the photos in your own directory tree. Files only move when you choose <strong>Move to folder</strong>{" "}
          or rename them by their date yourself, and a folder on an unplugged disk is skipped, not emptied.
        </p>
      ),
      links: [
        { label: "Folders view", to: "/docs/user-guide/viewing-photos#folders" },
        { label: "Library folders", to: "/docs/user-guide/library#library-folders" },
        { label: "Missing photos", to: "/docs/user-guide/missing-photos" },
      ],
    },
    {
      said: "Half of the scans have no date, and the rest have the scanner's date.",
      title: "Find undated photos and date them in bulk",
      body: (
        <p>
          <strong>Without timestamp</strong> lists every photo that has no date. Select a box of scans and{" "}
          <strong>Change date and time</strong> sets one date for all of them, or shifts a set by the same amount. Date
          rules decide which tag or which part of the file name a date is taken from.
        </p>
      ),
      links: [
        { label: "Without timestamp", to: "/docs/user-guide/viewing-photos#without-timestamp" },
        {
          label: "Changing the date of many photos",
          to: "/docs/user-guide/viewing-photos#changing-the-date-of-many-photos",
        },
        { label: "Date rules", to: "/docs/user-guide/settings/date-rules" },
      ],
    },
    {
      said: "Only my grandmother knew who all these people were.",
      title: "Faces grouped, named once, kept in the file",
      body: (
        <p>
          Faces are detected and grouped by similarity. You name a Person once and confirm or reject the suggestions,
          and you can draw a box around a face the scan missed. Names that digiKam or another tool wrote as face regions
          are read, and with <strong>Write face tags to image files</strong> your names are written back as standard
          MWG face regions.
        </p>
      ),
      links: [
        { label: "Face recognition", to: "/docs/user-guide/face-recognition" },
        { label: "Add a face the scan missed", to: "/docs/user-guide/face-recognition#add-a-face-the-scan-missed" },
        {
          label: "Writing face tags to your files",
          to: "/docs/user-guide/face-recognition#writing-face-tags-to-your-files",
        },
      ],
    },
    {
      said: "Postcards, letters and clippings: I need to search the words on them.",
      title: "Text recognition, when you turn it on",
      body: (
        <p>
          Text recognition (OCR) reads the text it can find on your photos, with a model that runs on your server. The text
          becomes searchable and can be selected and copied in the photo viewer, and it helps tell documents from
          photos. It is off on a new install: an administrator picks a model first, and only the owner of a photo sees
          its text.
        </p>
      ),
      links: [
        { label: "Turning it on", to: "/docs/user-guide/text-recognition#enabling" },
        { label: "Searching for text", to: "/docs/user-guide/text-recognition#searching-for-text" },
      ],
    },
    {
      said: "The descriptions have to travel with the files.",
      title: "Captions in the file, and suggestions to start from",
      body: (
        <p>
          A caption you type is stored with the photo and, with write-back on, written to the file&apos;s description
          fields. A captioning model on your server can suggest a caption that names the recognised people and the
          place. The generated caption is kept apart from yours: search finds it, but it only becomes your caption when
          you click it, and it is never written to the file.
        </p>
      ),
      links: [
        { label: "Image captioning", to: "/docs/user-guide/image-captioning" },
        { label: "What LibrePhotos writes", to: "/docs/user-guide/exif-data#what-librephotos-writes" },
      ],
    },
    {
      said: "We know where most of these were taken. There was no GPS in 1962.",
      title: "Set places by hand",
      body: (
        <p>
          Pick a location on the map or paste coordinates, for one photo or a whole selection. Place names are looked
          up on your own server by default, and a photo with a position appears on the map and under Places.
        </p>
      ),
      links: [
        { label: "Setting a location manually", to: "/docs/user-guide/places#setting-a-location-manually" },
        { label: "Places", to: "/docs/user-guide/places" },
      ],
    },
    {
      said: "We have to say who holds the rights to each picture.",
      title: "Creator, copyright and license",
      body: (
        <p>
          Each photo has a creator, a copyright notice and a license from a fixed list that includes the Creative
          Commons licenses, CC0 and the Public Domain Mark. Set them for one photo or many, read them from the files,
          and write them back to XMP with the other edits.
        </p>
      ),
      links: [{ label: "Copyright and licenses", to: "/docs/user-guide/rights" }],
    },
    {
      said: "Relatives and researchers should see the collection, not change it.",
      title: "Share to look, not to edit",
      body: (
        <p>
          Share an album with other users who can only view it, share your whole library read-only, or send a public
          link with an expiry date. What visitors see of each photo, such as dates, places and names, follows your
          public sharing settings.
        </p>
      ),
      links: [
        { label: "Sharing", to: "/docs/user-guide/sharing" },
        { label: "Sharing your whole library", to: "/docs/user-guide/sharing#sharing-your-whole-library" },
      ],
    },
    {
      said: "If this program goes away one day, the work must not go with it.",
      title: "The knowledge stays in standard files",
      body: (
        <p>
          With write-back on, dates, captions, locations, Tags, rights and named faces live in XMP that digiKam and
          other tools read. A zip download carries the sidecars with their files. LibrePhotos is MIT licensed and runs
          on hardware you control.
        </p>
      ),
      links: [
        { label: "Sidecars in a download", to: "/docs/user-guide/exif-data#sidecars-in-a-download" },
        { label: "Undoing write-back", to: "/docs/user-guide/exif-data#undoing-write-back" },
      ],
    },
  ],
  dayLead: "A day of work on a box of family prints, from the scanner to a cousin's inbox.",
  day: [
    {
      when: "Morning",
      title: "Scan the box",
      body: (
        <p>
          You scan a box of prints into a folder named after it. The next scan of your library adds them, without
          touching the folder.
        </p>
      ),
    },
    {
      when: "Dates",
      title: "Give the box its decade",
      body: (
        <p>
          In <strong>Without timestamp</strong> you select the new scans and use <strong>Set</strong> to give them the
          date written on the back of the album page.
        </p>
      ),
    },
    {
      when: "People",
      title: "Name the faces",
      body: (
        <p>
          On the face dashboard the new faces sit next to people you named last week. You confirm the matches and
          name the one new face your aunt recognised.
        </p>
      ),
    },
    {
      when: "Text",
      title: "Find the postcard",
      body: (
        <p>
          With text recognition on, a search for the name of a street finds the postcard that has it printed on the
          front.
        </p>
      ),
    },
    {
      when: "Afternoon",
      title: "Write it down once",
      body: (
        <p>
          You type a caption, set the place and the license. With <strong>Save to sidecar</strong> on, each change is
          also written to the XMP sidecar next to the scan.
        </p>
      ),
    },
    {
      when: "Evening",
      title: "Show the family",
      body: (
        <p>
          You add the best scans to an album and share it with your cousin&apos;s account, who can look but not
          change anything.
        </p>
      ),
    },
  ],
  gapsLead: "Things a collection may need that LibrePhotos does not offer today.",
  gaps: [
    {
      title: "No approximate dates",
      body: "A date is a day and a time. There is no field for \"around 1950\" or a year alone; pick a stand-in date and say so in the caption.",
    },
    {
      title: "One owner per photo",
      body: (
        <>
          Several volunteers cannot each own and edit the same collection from their own accounts (
          <Link href="https://github.com/LibrePhotos/librephotos/issues/395">#395</Link>). Use one shared archive
          account, as in{" "}
          <Link to="/docs/user-guide/sharing#setup-1-a-family-account">a family account</Link>.
        </>
      ),
    },
    {
      title: "Flat keywords",
      body: "Keyword hierarchies keep only their last level, and there is no controlled vocabulary or thesaurus.",
    },
    {
      title: "Titles are read, not written",
      body: "A photo's title is read from the file but not written back, and there are no custom metadata fields.",
    },
    {
      title: "Recognised text is stored as plain text",
      body: "The text from OCR sits unencrypted in the database, including the text of letters and IDs. Think about that before you turn it on.",
    },
    {
      title: "No two-factor sign-in",
      body: "Accounts sign in with a password or through your own single sign-on provider; LibrePhotos has no second factor of its own.",
    },
  ],
  start: {
    lead: (
      <>
        <p>
          Install LibrePhotos on a machine that can reach the archive folders, point it at them, and run the first
          scan. It only reads.
        </p>
        <p>
          Decide early whether LibrePhotos may write to your files, and whether to use sidecars or the files
          themselves.
        </p>
      </>
    ),
    actions: [
      { label: "Install LibrePhotos", to: "/docs/installation", filled: true },
      { label: "First steps", to: "/docs/user-guide/first-steps" },
      { label: "Metadata and XMP", to: "/docs/user-guide/exif-data" },
    ],
    note: (
      <>
        For a server without Internet access, see <Link to="/docs/user-guide/offline-setup">Offline usage</Link>.
      </>
    ),
  },
  faq: [
    {
      q: "Will LibrePhotos change or move my files?",
      a: (
        <p>
          Not on its own. A scan only reads. Files are written only when you set <strong>Write edits to files</strong>,
          and moved or renamed only when you choose to. Deleting a photo moves it to the trash, which stays until its
          owner empties it unless an admin sets an automatic deletion.
        </p>
      ),
    },
    {
      q: "Can several volunteers work on the same collection?",
      a: (
        <p>
          Not as co-owners. A collection can be owned by one shared account that the volunteers sign in to. Other users
          can be given <strong>Can add photos</strong> on an album to add photos from their own libraries. See{" "}
          <Link to="/docs/user-guide/sharing#sharing-photos-in-a-family">Sharing photos in a family</Link>.
        </p>
      ),
    },
    {
      q: "Can it run without an Internet connection?",
      a: (
        <p>
          Yes, once the models are in place: download them once and copy them over, as{" "}
          <Link to="/docs/user-guide/offline-setup">Offline usage</Link> describes. Place names come from a database
          on your server by default, and the map tiles can be switched off.
        </p>
      ),
    },
    {
      q: "What happens when the archive disk is not plugged in?",
      a: (
        <p>
          A library folder that cannot be read shows <strong>Not found</strong>, and scans skip it without marking its
          photos missing. When a scan would mark a large share of a library missing at once, it stops and asks whether
          the library is mounted.
        </p>
      ),
    },
    {
      q: "Is the generated caption good enough to publish?",
      a: (
        <p>
          Treat it as a draft. It comes from a small model on your server and can be wrong. It becomes your caption
          only when you click it, and it is never written to your files.
        </p>
      ),
    },
  ],
};

export default function Archivists(): ReactNode {
  return <UseCasePage useCase={USE_CASE} />;
}
