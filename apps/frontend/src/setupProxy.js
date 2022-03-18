const { createProxyMiddleware } = require("http-proxy-middleware");

module.exports = function (app) {
  app.use(
    "/api",
    createProxyMiddleware({
      // eslint-disable-next-line no-undef
      target: `http://${process.env.REACT_APP_PROXY_IP}:${process.env.REACT_APP_PROXY_PORT}`,
      changeOrigin: true,
    })
  );

  app.use(
    "/media",
    createProxyMiddleware({
      // eslint-disable-next-line no-undef
      target: `http://${process.env.REACT_APP_PROXY_IP}:${process.env.REACT_APP_PROXY_PORT}`,
      changeOrigin: true,
    })
  );
};
