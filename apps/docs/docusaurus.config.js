// @ts-check
// Note: type annotations allow type checking and IDEs autocompletion

const lightCodeTheme = require("prism-react-renderer/themes/github");
const darkCodeTheme = require("prism-react-renderer/themes/dracula");

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "LibrePhotos",
  tagline: "A self-hosted open source photo management service.",
  favicon: "img/favicon.ico",

  // Set the production url of your site here
  url: "https://docs.librephotos.com",
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: "/",

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: "LibrePhotos", // Usually your GitHub org/user name.
  projectName: "librephotos.docs", // Usually your repo name.

  onBrokenLinks: "throw",
  onBrokenMarkdownLinks: "warn",

  // Even if you don't use internalization, you can use this field to set useful
  // metadata like html lang. For example, if your site is Chinese, you may want
  // to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: require.resolve("./sidebars.js"),
          editUrl:
            "https://github.com/LibrePhotos/librephotos.docs/tree/master/",
        },
        blog: {
          showReadingTime: true,
          editUrl:
            "https://github.com/LibrePhotos/librephotos.docs/tree/master/",
        },
        theme: {
          customCss: require.resolve("./src/css/custom.css"),
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      // Replace with your project's social card
      image: "img/logo-round.png",
      navbar: {
        title: "LibrePhotos",
        logo: {
          alt: "My Site Logo",
          src: "img/logo-round.png",
        },
        items: [
          {
            type: "doc",
            docId: "intro",
            position: "left",
            label: "Docs",
          },
          {
            type: "doc",
            docId: "development/dev-install",
            position: "left",
            label: "Development",
          },
          { to: "/blog", label: "Blog", position: "left" },
          {
            href: "https://github.com/LibrePhotos",
            label: "GitHub",
            position: "right",
          },
        ],
      },
      footer: {
        style: "dark",
        links: [
          {
            title: "Docs",
            items: [
              {
                label: "Docs",
                to: "/docs/intro",
              },
              {
                label: "Development",
                to: "/docs/development/dev-install",
              },
            ],
          },

          {
            title: "Community",
            items: [
              {
                label: "Discord",
                href: "https://discord.com/invite/xwRvtSDGWb",
              },
              {
                label: "Development videos",
                href: "https://www.youtube.com/channel/UCZJ2pk2BPKxwbuCV9LWDR0w",
              },
            ],
          },
          {
            title: "More",
            items: [
              {
                label: "Blog",
                to: "/blog",
              },
              {
                label: "Demo",
                href: "https://demo2.librephotos.com/",
              },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} LibrePhotos. Built with Docusaurus.`,
      },
      prism: {
        theme: lightCodeTheme,
        darkTheme: darkCodeTheme,
      },
    }),
};

module.exports = config;
