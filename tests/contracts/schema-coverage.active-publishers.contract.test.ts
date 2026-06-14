import { describe, it } from 'bun:test'
import { activePublisherSchemaContracts, assertRoundTrip } from './_helpers/schema-coverage.ts'

describe('object-form active event payload schemas', () => {
  activePublisherSchemaContracts.forEach(({ subject, schema, fixture }) => {
    it(`round-trips ${subject}`, () => {
      assertRoundTrip(schema, fixture)
    })
  })
})
