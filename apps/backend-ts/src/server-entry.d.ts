declare module "*/dist/server/server.js" {
  const handler: { fetch(req: Request): Response | Promise<Response> };
  export default handler;
  export function lpFetch(req: Request, peer?: string): Promise<Response>;
  export function prepareServer(): void;
  export function startBackground(): Promise<void>;
}
