import { describe, it } from 'bun:test'
import { mTaskEventContracts, mTaskResponseContracts } from './_helpers/schema-coverage.m-task.ts'
import { assertRoundTrip } from './_helpers/schema-coverage.ts'

describe('active event payload schemas', () => {
  mTaskEventContracts.forEach(({ subject, schema, fixture }) => {
    it(`round-trips ${subject}`, () => {
      assertRoundTrip(schema, fixture)
    })
  })
})

describe('active REST response schemas', () => {
  mTaskResponseContracts.forEach(({ route, schema, fixture }) => {
    it(`round-trips ${route}`, () => {
      assertRoundTrip(schema, fixture)
    })
  })
})
