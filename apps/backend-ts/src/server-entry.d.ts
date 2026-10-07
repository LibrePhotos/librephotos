declare module "*/dist/server/server.js" {
  const handler: { fetch(req: Request): Response | Promise<Response> };
  export default handler;
}
