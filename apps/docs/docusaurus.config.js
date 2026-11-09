// @ts-check
// Note: type annotations allow type checking and IDEs autocompletion

const { themes } = require("prism-react-renderer");
const htmlTableStructure = require("./src/remark/html-table-structure");

// Code blocks sit on the app's surfaces: grey-0 in the light scheme, the raised near-black (dark-6
// of DARK_SCALE) in the dark one, instead of the themes' own GitHub grey and One Dark slate.
const lightCodeTheme = {
  ...themes.github,
  plain: { ...themes.github.plain, backgroundColor: "#f8f9fa" },
};
const darkCodeTheme = {
  ...themes.oneDark,
  plain: { ...themes.oneDark.plain, backgroundColor: "#1f1f23" },
};

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

  // Search in the browser over an index built with the site: no external service or account.
  themes: [
    [
      require.resolve("@easyops-cn/docusaurus-search-local"),
      /** @type {import("@easyops-cn/docusaurus-search-local").PluginOptions} */
      ({
        hashed: true,
        language: ["en"],
        indexBlog: true,
        docsRouteBasePath: "/docs",
        blogRouteBasePath: "/blog",
        highlightSearchTermsOnTargetPage: true,
        explicitSearchResultPath: true,
        searchResultLimits: 8,
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
        // The app header's mark: ink on the light chrome, white on the dark one.
        logo: {
          alt: "LibrePhotos logo",
          src: "brand/logo.png",
          srcDark: "brand/logo-white.png",
        },
        items: [
          // Plain links with their own patterns: as `doc` items both would be marked current on
          // every page, since the docs are one sidebar.
          {
            to: "/docs/intro",
            position: "left",
            label: "Docs",
            activeBaseRegex: "^/docs/(?!development)",
          },
          {
            to: "/docs/development/dev-install",
            position: "left",
            label: "Development",
            activeBaseRegex: "^/docs/development",
          },
          { to: "/blog", label: "Blog", position: "left" },
          // The local search (themes above), a pill like the app's header search
          { type: "search", position: "right" },
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
        style: "light",
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
