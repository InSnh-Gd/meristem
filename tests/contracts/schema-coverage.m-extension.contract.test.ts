import { describe, it } from 'bun:test'
import {
  mExtensionEventContracts,
  mExtensionResponseContracts
} from './_helpers/schema-coverage.m-extension.ts'
import { assertRoundTrip } from './_helpers/schema-coverage.ts'

describe('active event payload schemas', () => {
  mExtensionEventContracts.forEach(({ subject, schema, fixture }) => {
    it(`round-trips ${subject}`, () => {
      assertRoundTrip(schema, fixture)
    })
  })
})

describe('active REST response schemas', () => {
  mExtensionResponseContracts.forEach(({ route, schema, fixture }) => {
    it(`round-trips ${route}`, () => {
      assertRoundTrip(schema, fixture)
    })
  })
})
