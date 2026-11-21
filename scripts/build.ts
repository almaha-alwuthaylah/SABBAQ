// Static production build → dist/  (deploy the folder to any static host, e.g. GitHub Pages)
import { cpSync, mkdirSync, rmSync, renameSync, existsSync } from "fs";

const out = "dist";
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const common = { target: "browser" as const, minify: true, define: { "process.env.NODE_ENV": '"production"' } };
const app = await Bun.build({ ...common, entrypoints: ["src/main.tsx"], outdir: out, naming: "app.[ext]" });
const worker = await Bun.build({ ...common, entrypoints: ["src/sim/worker.ts"], outdir: out, naming: "worker.[ext]" });
for (const r of [app, worker]) if (!r.success) { console.error(r.logs); process.exit(1); }
if (existsSync(`${out}/main.css`)) renameSync(`${out}/main.css`, `${out}/app.css`);
cpSync("public/index.html", `${out}/index.html`);
cpSync("public/og-image.png", `${out}/og-image.png`);
console.log(`built ${out}/`);
