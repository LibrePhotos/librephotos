// @ts-check
// Note: type annotations allow type checking and IDEs autocompletion

const { themes } = require("prism-react-renderer");
const htmlTableStructure = require("./src/remark/html-table-structure");

const lightCodeTheme = themes.github;
const darkCodeTheme = themes.dracula;

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
  organizationName: "LibrePhotos",
  projectName: "librephotos",

  headTags: [
    { tagName: "link", attributes: { rel: "preconnect", href: "https://fonts.googleapis.com" } },
    { tagName: "link", attributes: { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "anonymous" } },
  ],
  stylesheets: [
    "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700&display=swap",
  ],

  onBrokenLinks: "throw",

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },

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
          remarkPlugins: [htmlTableStructure],
          editUrl:
            "https://github.com/LibrePhotos/librephotos/tree/dev/apps/docs/",
        },
        blog: {
          showReadingTime: true,
          remarkPlugins: [htmlTableStructure],
          // Release notes are short and have always been shown in full on the
          // blog index, so don't nag about missing truncate markers.
          onUntruncatedBlogPosts: "ignore",
          editUrl:
            "https://github.com/LibrePhotos/librephotos/tree/dev/apps/docs/",
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
      image: "img/logo-round.png",
      colorMode: { respectPrefersColorScheme: true },
      navbar: {
        title: "LibrePhotos",
        logo: {
          alt: "LibrePhotos logo",
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
            href: "https://github.com/LibrePhotos/librephotos",
            label: "GitHub",
            position: "right",
          },
          {
            href: "https://github.com/sponsors/derneuere",
            label: "Sponsor",
            position: "right",
            className: "navbar__sponsor",
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
                label: "Sponsor on GitHub",
                href: "https://github.com/sponsors/derneuere",
              },
              {
                label: "Donate via PayPal",
                href: "https://www.paypal.com/donate/?hosted_button_id=5JWVM2UR4LM96",
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
        // prism-react-renderer 2 no longer bundles bash (also sh/shell), so
        // without this the shell snippets all over the docs render unhighlighted.
        additionalLanguages: ["bash", "powershell", "nginx"],
      },
    }),
};

module.exports = config;
