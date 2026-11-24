import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const watch = process.argv.includes("--watch");

const options = {
    entryPoints: {
        background: "src/background/index.ts",
        content: "src/content/index.ts",
        sidepanel: "src/sidepanel/index.ts",
        options: "src/options/index.ts",
    },
    outdir: "dist",
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    sourcemap: true,
    logLevel: "info",
};

// Static files are copied once per run; restart `watch` after editing them.
const staticFiles = [
    ["manifest.json", "dist/manifest.json"],
    ["src/sidepanel/index.html", "dist/sidepanel.html"],
    ["src/options/index.html", "dist/options.html"],
    ["src/shared/ui.css", "dist/ui.css"],
];

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
for (const [from, to] of staticFiles) {
    await cp(from, to);
}

if (watch) {
    const ctx = await context(options);
    await ctx.watch();
} else {
    await build(options);
}
