/** Stub for solid-start:get-manifest when resolved outside SolidStart plugin (e.g. Nitro worker). */
export function getManifest(_env: "client" | "ssr") {
  return {
    getAssets: async (_id: string) => [] as const,
  }
}
