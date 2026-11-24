import { build, context } from "esbuild";
import { existsSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";

const watch = process.argv.includes("--watch");
// The test build goes to its own folder and never carries a key, so running
// the tests neither depends on .env nor strips the key from dist/.
const forTests = process.argv.includes("--test");
const outdir = forTests ? "dist-test" : "dist";

// Values already set in the shell win over .env.
if (!forTests && existsSync(".env")) {
    process.loadEnvFile(".env");
}
const apiKey = forTests ? "" : (process.env.ANTHROPIC_API_KEY ?? "").trim();

const options = {
    entryPoints: {
        background: "src/background/index.ts",
        content: "src/content/index.ts",
        sidepanel: "src/sidepanel/index.ts",
        options: "src/options/index.ts",
    },
    outdir,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    sourcemap: true,
    logLevel: "info",
    define: {
        __BUILD_API_KEY__: JSON.stringify(apiKey),
    },
};

// Static files are copied once per run; restart `watch` after editing them.
const staticFiles = [
    ["manifest.json", "manifest.json"],
    ["src/sidepanel/index.html", "sidepanel.html"],
    ["src/options/index.html", "options.html"],
    ["src/shared/ui.css", "ui.css"],
];

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
for (const [from, to] of staticFiles) {
    await cp(from, `${outdir}/${to}`);
}

if (!forTests) {
    console.log(
        apiKey
            ? `API key: taken from the environment and written into ${outdir}/ in plain text. Keep that folder to yourself.`
            : "API key: none in the environment; enter it on the extension's options page.",
    );
}

if (watch) {
    const ctx = await context(options);
    await ctx.watch();
} else {
    await build(options);
}
