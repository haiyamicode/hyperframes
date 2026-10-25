#!/usr/bin/env node
// Publishes this fork's player and studio as @haiyamicode/hyperframes-player and
// @haiyamicode/hyperframes-studio. Every other @hyperframes package stays upstream: workspace
// dependencies are pinned to their upstream version, and the studio's @hyperframes/player is an
// npm alias of the forked player, so its imports resolve unchanged.
//
//   node scripts/publish-lazybird.mjs <version> [--dry-run]
//
// <version> is the upstream release plus a fork counter, e.g. 0.8.192-lzb.1.

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REGISTRY = "https://npm.haiyami.com/";
const REPOSITORY = "git+https://github.com/haiyamicode/hyperframes.git";
/** Forked package → its published name, in publish order (the studio depends on the player). */
const FORKED = new Map([
  ["@hyperframes/player", "@haiyamicode/hyperframes-player"],
  ["@hyperframes/studio", "@haiyamicode/hyperframes-studio"],
]);

const [version, ...flags] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+-lzb\.\d+$/.test(version ?? "")) {
  console.error("usage: node scripts/publish-lazybird.mjs <x.y.z-lzb.n> [--dry-run]");
  process.exit(1);
}
const dryRun = flags.includes("--dry-run");

const root = join(import.meta.dirname, "..");
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: "inherit" });

const workspace = new Map(
  readdirSync(join(root, "packages"))
    .map((dir) => join(root, "packages", dir))
    .filter((dir) => existsSync(join(dir, "package.json")))
    .map((dir) => {
      const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      return [manifest.name, { dir, manifest }];
    }),
);

function resolveDependencies(dependencies) {
  if (!dependencies) return undefined;
  return Object.fromEntries(
    Object.entries(dependencies).map(([name, spec]) => {
      if (FORKED.has(name)) return [name, `npm:${FORKED.get(name)}@${version}`];
      if (spec.startsWith("workspace:")) return [name, workspace.get(name).manifest.version];
      return [name, spec];
    }),
  );
}

/** The manifest as published: publishConfig applied, no scripts, forked name and version. */
function publishedManifest(manifest) {
  const { publishConfig = {}, scripts: _scripts, devDependencies: _devDeps, ...rest } = manifest;
  const { access: _access, registry: _registry, tag: _tag, ...overrides } = publishConfig;
  return {
    ...rest,
    ...overrides,
    name: FORKED.get(manifest.name),
    version,
    description: `${manifest.description ?? manifest.name} (Lazybird fork of ${manifest.name}@${manifest.version})`,
    repository: { type: "git", url: REPOSITORY, directory: manifest.repository?.directory },
    dependencies: resolveDependencies(manifest.dependencies),
    optionalDependencies: resolveDependencies(manifest.optionalDependencies),
    peerDependencies: resolveDependencies(manifest.peerDependencies),
  };
}

// The root build's order, limited to what the player and studio build from.
run("bun", ["run", "--filter", "@hyperframes/{parsers,lint,studio-server}", "build"]);
run("bun", ["run", "--filter", "@hyperframes/core", "build"]);
run("bun", ["run", "--filter", "@hyperframes/{sdk,shader-transitions,player}", "build"]);
run("bun", ["run", "--filter", "@hyperframes/studio", "build"]);

for (const name of FORKED.keys()) {
  const { dir, manifest } = workspace.get(name);
  const stage = mkdtempSync(join(tmpdir(), "hyperframes-publish-"));
  try {
    for (const entry of [...manifest.files, "README.md"]) {
      if (existsSync(join(dir, entry)))
        cpSync(join(dir, entry), join(stage, entry), { recursive: true });
    }
    cpSync(join(root, "LICENSE"), join(stage, "LICENSE"));
    writeFileSync(
      join(stage, "package.json"),
      `${JSON.stringify(publishedManifest(manifest), null, 2)}\n`,
    );
    run(
      "npm",
      ["publish", "--registry", REGISTRY, "--tag", "latest", ...(dryRun ? ["--dry-run"] : [])],
      stage,
    );
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
