import { describe, it } from 'bun:test'
import {
  sharedEventContracts,
  sharedResponseContracts
} from './_helpers/schema-coverage.shared-domain.ts'
import { assertRoundTrip } from './_helpers/schema-coverage.ts'

describe('active event payload schemas', () => {
  sharedEventContracts.forEach(({ subject, schema, fixture }) => {
    it(`round-trips ${subject}`, () => {
      assertRoundTrip(schema, fixture)
    })
  })
})

describe('active REST response schemas', () => {
  sharedResponseContracts.forEach(({ route, schema, fixture }) => {
    it(`round-trips ${route}`, () => {
      assertRoundTrip(schema, fixture)
    })
  })
})
