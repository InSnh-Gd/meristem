import { describe, it } from 'bun:test'
import { mLogResponseContracts } from './_helpers/schema-coverage.m-log.ts'
import { assertRoundTrip } from './_helpers/schema-coverage.ts'

describe('active REST response schemas', () => {
  mLogResponseContracts.forEach(({ route, schema, fixture }) => {
    it(`round-trips ${route}`, () => {
      assertRoundTrip(schema, fixture)
    })
  })
})
