import { describe, it } from 'bun:test'
import { secretResponseContracts } from './_helpers/schema-coverage.secrets.ts'
import { assertRoundTrip } from './_helpers/schema-coverage.ts'

describe('active REST response schemas', () => {
  secretResponseContracts.forEach(({ route, schema, fixture }) => {
    it(`round-trips ${route}`, () => {
      assertRoundTrip(schema, fixture)
    })
  })
})
