import { describe, it } from 'bun:test'
import {
  mPolicyEventContracts,
  mPolicyResponseContracts
} from './_helpers/schema-coverage.m-policy.ts'
import { assertRoundTrip } from './_helpers/schema-coverage.ts'

describe('active event payload schemas', () => {
  mPolicyEventContracts.forEach(({ subject, schema, fixture }) => {
    it(`round-trips ${subject}`, () => {
      assertRoundTrip(schema, fixture)
    })
  })
})

describe('active REST response schemas', () => {
  mPolicyResponseContracts.forEach(({ route, schema, fixture }) => {
    it(`round-trips ${route}`, () => {
      assertRoundTrip(schema, fixture)
    })
  })
})
