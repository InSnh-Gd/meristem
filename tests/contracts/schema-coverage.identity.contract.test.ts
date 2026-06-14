import { describe, it } from 'bun:test'
import { identityResponseContracts } from './_helpers/schema-coverage.identity.ts'
import { assertRoundTrip } from './_helpers/schema-coverage.ts'

describe('active REST response schemas', () => {
  identityResponseContracts.forEach(({ route, schema, fixture }) => {
    it(`round-trips ${route}`, () => {
      assertRoundTrip(schema, fixture)
    })
  })
})
