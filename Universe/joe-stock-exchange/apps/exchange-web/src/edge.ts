interface EdgeEnv {
  ASSETS: { fetch(r: Request): Promise<Response> };
  EXCHANGE_API: { fetch(r: Request): Promise<Response> };
}
export default {
  async fetch(request: Request, env: EdgeEnv): Promise<Response> {
    if (new URL(request.url).pathname.startsWith("/v1/")) {
      const headers = new Headers(request.headers);
      headers.set("x-joese-surface", "member");
      return env.EXCHANGE_API.fetch(new Request(request, { headers }));
    }
    return env.ASSETS.fetch(request);
  },
};
