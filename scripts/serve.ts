// Minimal static server for local preview: bun scripts/serve.ts [dir] [port]
const dir = process.argv[2] ?? "dist";
Bun.serve({ port: Number(process.argv[3] ?? 4173), async fetch(req) {
  let p = new URL(req.url).pathname; if (p === "/") p = "/index.html";
  const f = Bun.file(dir + p); return (await f.exists()) ? new Response(f) : new Response("nf", { status: 404 });
}});
console.log("serving", dir);
