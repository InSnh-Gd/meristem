import { describe, expect, it } from 'bun:test'
import {
  ProjectionUnknownIndexError,
  ProjectionWorkflowError
} from '../../../services/m-log/src/projection/errors.ts'

describe('projection errors', () => {
  it('creates unknown index errors with stable tag and fields', () => {
    const error = new ProjectionUnknownIndexError({
      index: 'meristem-unknown',
      message: 'missing index'
    })

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(ProjectionUnknownIndexError)
    expect(error.name).toBe('ProjectionUnknownIndexError')
    expect(error._tag).toBe('ProjectionUnknownIndexError')
    expect(error.index).toBe('meristem-unknown')
    expect(error.message).toBe('missing index')
  })

  it('creates workflow errors with stable tag and fields', () => {
    const error = new ProjectionWorkflowError({ operation: 'project.timeline', message: 'failed' })

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(ProjectionWorkflowError)
    expect(error.name).toBe('ProjectionWorkflowError')
    expect(error._tag).toBe('ProjectionWorkflowError')
    expect(error.operation).toBe('project.timeline')
    expect(error.message).toBe('failed')
  })
})
