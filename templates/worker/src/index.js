export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    return new Response("Discord bot scaffold is ready.", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
