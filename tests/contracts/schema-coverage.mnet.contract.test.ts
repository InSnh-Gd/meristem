import { describe, it } from 'bun:test'
import { mnetEventContracts, mnetResponseContracts } from './_helpers/schema-coverage.mnet.ts'
import { mnetV03EventContracts } from './_helpers/schema-coverage.mnet-v03.ts'
import { assertRoundTrip } from './_helpers/schema-coverage.ts'

describe('active event payload schemas', () => {
  ;[...mnetEventContracts, ...mnetV03EventContracts].forEach(({ subject, schema, fixture }) => {
    it(`round-trips ${subject}`, () => {
      assertRoundTrip(schema, fixture)
    })
  })
})

describe('active REST response schemas', () => {
  mnetResponseContracts.forEach(({ route, schema, fixture }) => {
    it(`round-trips ${route}`, () => {
      assertRoundTrip(schema, fixture)
    })
  })
})
