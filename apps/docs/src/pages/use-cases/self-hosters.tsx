import React, { type ReactNode } from "react";
import Link from "@docusaurus/Link";
import UseCasePage, { type UseCase } from "./_shared/UseCasePage";

const K8S_URL = "https://github.com/LibrePhotos/librephotos/tree/dev/deploy/k8s#kubernetes-installation";

const USE_CASE: UseCase = {
  slug: "self-hosters",
  pageTitle: "LibrePhotos for self-hosters",
  description:
    "How LibrePhotos serves self-hosters and homelab users: local machine learning, offline place names, Docker, Kubernetes, Unraid or Windows, single sign-on, an API, every outgoing connection listed, and what it does not do yet.",
  title: "A photo server that runs on your hardware and keeps to itself.",
  lead: (
    <>
      Faces, Things, captions and search are worked out by models on your own server. Place names are looked up from a
      database on the server too. The connections a default install makes to the outside are listed below, with the
      switch that turns each one off.
    </>
  ),
  hero: { kind: "app", id: "admin-site-settings" },
  problemsLead: (
    <>
      What people who run their own services ask before they install a photo server, and what LibrePhotos does about
      it. Every answer links to the page of the documentation that explains it in full.
    </>
  ),
  problems: [
    {
      said: "No cloud. My photos and the faces in them stay on my box.",
      title: "Machine learning on your server",
      body: (
        <p>
          Face detection, Things, captions, semantic search and text recognition run on ONNX Runtime inside your
          deployment. Once the models are downloaded, none of them needs the Internet. New installs look place names
          up with ExifTool&apos;s offline database, so coordinates do not leave the server either.
        </p>
      ),
      links: [
        { label: "Offline usage", to: "/docs/user-guide/offline-setup" },
        { label: "Offline place names", to: "/docs/user-guide/places#offline-place-names-with-exiftool" },
      ],
    },
    {
      said: "Tell me exactly what it sends, and to whom.",
      title: "Outgoing connections, and how to stop them",
      body: (
        <ul>
          <li>Model downloads from Hugging Face, or none if you copy the models in by hand.</li>
          <li>
            A daily check on github.com for the newest release, which sends nothing about your server. Switch it off in
            the site settings or with <code>UPDATE_CHECK=false</code>.
          </li>
          <li>
            Map tiles, from PhotoPrism&apos;s tile server by default. Choose OpenStreetMap, or <strong>None</strong> to
            load no maps.
          </li>
          <li>Place names, only if you pick an online provider such as Nominatim instead of ExifTool.</li>
          <li>Nextcloud, outgoing email and single sign-on, only to the servers you set up yourself.</li>
          <li>Error reports stay on your server until an admin decides to share them.</li>
        </ul>
      ),
      links: [
        { label: "Checking for new releases", to: "/docs/installation/environment-variables#update-check" },
        { label: "Map privacy", to: "/docs/user-guide/places#privacy-considerations" },
        { label: "Error reporting", to: "/docs/user-guide/error-reporting" },
      ],
    },
    {
      said: "I want to run it the way I run everything else.",
      title: "Your deployment, your database",
      body: (
        <p>
          One container with SQLite inside, a Docker Compose setup with a separate proxy, Kubernetes manifests, an
          Unraid template, or a Windows program that needs no Docker. Use the built-in SQLite or your own PostgreSQL.
          Images are built for x86 and ARM64.
        </p>
      ),
      links: [
        { label: "Installation", to: "/docs/installation" },
        { label: "Single container", to: "/docs/installation/unified-deployment" },
        { label: "Unraid", to: "/docs/installation/unraid" },
      ],
    },
    {
      said: "The box is small. I do not need every model running.",
      title: "Turn off what you do not use",
      body: (
        <p>
          Face detection, captions, Things and video previews each have a switch, in the site settings or as an
          environment variable. Face detection and captions, once off, do not start their service or download their
          model. Text recognition is off until you pick a model. Containers can be capped in CPU and memory.
        </p>
      ),
      links: [
        { label: "Minimal machine learning", to: "/docs/user-guide/feature-toggles#minimal-machine-learning" },
        {
          label: "Limiting CPU and memory",
          to: "/docs/installation/environment-variables#limiting-cpu-and-memory-usage",
        },
      ],
    },
    {
      said: "I have a GPU in there. Use it.",
      title: "Models on Intel, AMD or NVIDIA",
      body: (
        <p>
          Both the standard setup and the single container can run the models on an Intel, AMD or NVIDIA graphics card.
          Video conversion stays on the CPU.
        </p>
      ),
      links: [
        { label: "GPU acceleration", to: "/docs/installation/environment-variables#utilizing-gpu-acceleration" },
      ],
    },
    {
      said: "Everyone already has an account in my identity provider.",
      title: "Single sign-on with OpenID Connect",
      body: (
        <p>
          Keycloak, Authentik, Authelia, Zitadel and other OpenID Connect providers can handle sign-in, and LDAP
          accounts come in through such a provider. Password sign-in keeps working next to it.
        </p>
      ),
      links: [
        { label: "Single sign-on", to: "/docs/user-guide/settings/single-sign-on" },
        { label: "LDAP accounts", to: "/docs/user-guide/settings/single-sign-on#using-ldap-accounts" },
      ],
    },
    {
      said: "I script everything.",
      title: "API, management commands and schedules",
      body: (
        <p>
          The REST API takes JWT or Basic auth. Management commands scan libraries, create users, write metadata and
          back up an SQLite database. Scans can run on a schedule set in the app, or be started by a folder watcher
          or a cron job on the host.
        </p>
      ),
      links: [
        { label: "API authentication", to: "/docs/user-guide/api-authentication" },
        { label: "Management commands", to: "/docs/user-guide/library#management-commands" },
        { label: "Auto scan", to: "/docs/user-guide/auto-scan" },
      ],
    },
    {
      said: "My photo share is precious. I would rather mount it read-only.",
      title: "Read-only works, with known limits",
      body: (
        <p>
          LibrePhotos indexes a read-only library. Writing metadata back, uploads and deleting files need write access.
          A metadata write that fails keeps the edit in LibrePhotos and says so; uploads and deletions fail with less
          helpful errors today.
        </p>
      ),
      links: [
        {
          label: "Why the scan directory is not read-only",
          to: "/docs/user-guide/faq#why-is-the-scan-directory-not-mounted-read-only",
        },
      ],
    },
  ],
  dayLead: "From an empty Compose file to the first searchable library.",
  day: [
    {
      when: "Setup",
      title: "Start one container",
      body: (
        <p>
          You add the single-container service to your Compose file, mount the photo share as <code>/data</code> and
          start it. The first-time setup asks for the admin account, the site settings, where error reports go and the
          scan directory.
        </p>
      ),
    },
    {
      when: "Before the scan",
      title: "Switch off what you do not need",
      body: (
        <p>
          You leave captions off on this small box, set <strong>Map tiles</strong> to OpenStreetMap, and keep place
          names on ExifTool.
        </p>
      ),
    },
    {
      when: "First scan",
      title: "Watch the jobs",
      body: (
        <p>
          The scan, face detection and the other jobs show their progress under <strong>My jobs</strong>, and the
          Admin area lists the services and their state.
        </p>
      ),
    },
    {
      when: "Sign-in",
      title: "Hand sign-in to your identity provider",
      body: <p>You register LibrePhotos with your OpenID Connect provider and turn single sign-on on in the site settings.</p>,
    },
    {
      when: "Night",
      title: "Back up and schedule",
      body: (
        <p>
          A daily scan picks up new files, and a cron job runs the database backup command before your usual backup of
          the host.
        </p>
      ),
    },
  ],
  gapsLead: "What a self-hoster may expect from a photo server that LibrePhotos does not do today.",
  gaps: [
    {
      title: "No two-factor authentication",
      body: "There is no second factor in LibrePhotos itself. Put it in front through your single sign-on provider.",
    },
    {
      title: "No personal API keys",
      body: "API clients sign in with a username and password and get short-lived JWT tokens.",
    },
    {
      title: "No object storage",
      body: "Photos are read from local paths. There is no S3 backend.",
    },
    {
      title: "Needs a CPU with AVX",
      body: "Older processors, and virtual machines that hide the AVX flag, cannot run the models.",
    },
    {
      title: "One model you cannot switch off",
      body: "OpenCLIP (about 600 MB) is always downloaded and its service keeps running, since it serves semantic search and similar photos.",
    },
    {
      title: "No storage quotas",
      body: "There is no limit on how much each user stores.",
    },
  ],
  start: {
    lead: (
      <>
        <p>
          The installation guide recommends the single-container deployment for most people. It needs an x86 or ARM64
          machine, and the guide recommends 4 GB of memory.
        </p>
        <p>
          On Kubernetes, use the <Link href={K8S_URL}>manifests in deploy/k8s</Link>.
        </p>
      </>
    ),
    actions: [
      { label: "Single container", to: "/docs/installation/unified-deployment", filled: true },
      { label: "All install methods", to: "/docs/installation" },
      { label: "Environment variables", to: "/docs/installation/environment-variables" },
    ],
    note: (
      <>
        Upgrading later? Read <Link to="/docs/installation/upgrading">Upgrading</Link> first.
      </>
    ),
  },
  faq: [
    {
      q: "Does LibrePhotos send telemetry?",
      a: (
        <p>
          LibrePhotos itself has none. ONNX Runtime, which runs the models, sends usage data to Microsoft from its
          version 1.29 on; LibrePhotos switches that off by default from 1.6.0 with <code>ORT_DISABLE_TELEMETRY</code>.
          See <Link to="/docs/installation/environment-variables#onnx-runtime-telemetry">ONNX Runtime telemetry</Link>.
        </p>
      ),
    },
    {
      q: "Can it run with no Internet access at all?",
      a: (
        <p>
          Yes. Download the models once and place them by hand, keep place names on ExifTool, set{" "}
          <strong>Map tiles</strong> to <strong>None</strong> and switch off the release check.{" "}
          <Link to="/docs/user-guide/offline-setup">Offline usage</Link> lists the steps.
        </p>
      ),
    },
    {
      q: "SQLite or PostgreSQL?",
      a: (
        <p>
          Both work. The single container can keep SQLite inside, which suits one machine. PostgreSQL suits an existing
          database server or the multi-container setup. Back up SQLite with the <code>backup_database</code> command,
          PostgreSQL with <code>pg_dump</code>.
        </p>
      ),
    },
    {
      q: "Can I run it on Windows without Docker?",
      a: (
        <p>
          Yes, with the <Link to="/docs/installation/windows-standalone">Windows standalone</Link> build: one folder
          with the server, the web app and the models, and SQLite as the database. It is meant for one person&apos;s
          library on their own PC.
        </p>
      ),
    },
    {
      q: "Is there a paid version?",
      a: <p>No. LibrePhotos is MIT licensed, with no paid tier and no license key.</p>,
    },
  ],
};

export default function SelfHosters(): ReactNode {
  return <UseCasePage useCase={USE_CASE} />;
}
