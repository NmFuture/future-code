#!/usr/bin/env bun

Bun.build({
  entrypoints: ["./src/node.ts"],
  target: "node",
  outdir: "./dist",
  format: "esm",
})
