// Workers static assets ignore Range headers, and Safari won't play a <video> without 206 responses.
// This runs only for the hero video (assets.runWorkerFirst) and slices the asset to the requested range.
interface Env { ASSETS: Fetcher }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
    const res = await env.ASSETS.fetch(request.url, { method: request.method });
    if (!m || res.status !== 200) return res;
    const body = await res.arrayBuffer(), size = body.byteLength;
    const start = m[1] ? +m[1] : size - +m[2], end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
    const headers = new Headers(res.headers);
    headers.set("accept-ranges", "bytes");
    if (!(start >= 0 && start <= end)) {
      headers.set("content-range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set("content-range", `bytes ${start}-${end}/${size}`);
    headers.set("content-length", String(end - start + 1));
    return new Response(body.slice(start, end + 1), { status: 206, headers });
  },
};
