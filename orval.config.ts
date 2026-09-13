import { defineConfig } from 'orval'

// Regenerate with `npm run api:generate` after `npm run api:sync` copies the backend's
// spec into openapi/. The output in src/api/generated is committed, so API changes
// show up in review.
export default defineConfig({
  admin: {
    input: {
      target: './openapi/openapi.json',
      // Only the admin surface. Traveler-facing endpoints are not the panel's.
      filters: { tags: [/^Admin - /] },
    },
    output: {
      // One endpoints file plus a model folder. The spec's tags mix casing
      // ("Admin - airlines" / "Admin - Airlines"), so splitting by tag would
      // produce near-duplicate files.
      mode: 'split',
      target: './src/api/generated/admin.ts',
      schemas: './src/api/generated/model',
      client: 'react-query',
      httpClient: 'axios',
      clean: true,
      override: {
        mutator: { path: './src/api/orvalMutator.ts', name: 'apiRequest' },
      },
    },
  },
})
