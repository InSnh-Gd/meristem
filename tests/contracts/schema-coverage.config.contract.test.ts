import { describe, it } from 'bun:test'
import { configResponseContracts } from './_helpers/schema-coverage.config.ts'
import { assertRoundTrip } from './_helpers/schema-coverage.ts'

describe('active REST response schemas', () => {
  configResponseContracts.forEach(({ route, schema, fixture }) => {
    it(`round-trips ${route}`, () => {
      assertRoundTrip(schema, fixture)
    })
  })
})
