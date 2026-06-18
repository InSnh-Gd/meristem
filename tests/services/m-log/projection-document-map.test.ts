import { describe, expect, it } from 'bun:test'
import { mapFactToDoc } from '../../../services/m-log/src/projection/document-map.ts'

describe('mapFactToDoc', () => {
  it('maps timeline rows to timeline documents', () => {
    const timestamp = new Date('2026-01-02T03:04:05.000Z')

    expect(
      mapFactToDoc('meristem-timeline-logs-v0', {
        timestamp,
        summary: 'task completed',
        subject: 'projection-map-resource',
        correlation_id: 'corr-1'
      })
    ).toEqual({
      timestamp: '2026-01-02T03:04:05.000Z',
      summary: 'task completed',
      subject: 'projection-map-resource',
      correlationId: 'corr-1'
    })
  })

  it('maps full rows to full log documents with defaults', () => {
    expect(
      mapFactToDoc('meristem-full-logs-v0', {
        timestamp: new Date('2026-02-03T04:05:06.000Z'),
        message: 'worker started'
      })
    ).toEqual({
      timestamp: '2026-02-03T04:05:06.000Z',
      level: 'info',
      source: '',
      message: 'worker started',
      correlationId: null,
      traceId: null,
      payload: null
    })
  })

  it('maps audit rows to audit log documents', () => {
    expect(
      mapFactToDoc('meristem-audit-logs-v0', {
        timestamp: new Date('2026-03-04T05:06:07.000Z'),
        actor: 'operator',
        action: 'task.cancel',
        resource: 'projection-map-resource',
        decision_id: 'decision-1',
        result: 'allowed',
        correlation_id: 'corr-2',
        trace_id: 'trace-2',
        payload: { id: 'projection-map-resource' }
      })
    ).toEqual({
      timestamp: '2026-03-04T05:06:07.000Z',
      actor: 'operator',
      action: 'task.cancel',
      resource: 'projection-map-resource',
      decisionId: 'decision-1',
      result: 'allowed',
      correlationId: 'corr-2',
      traceId: 'trace-2',
      payload: { id: 'projection-map-resource' }
    })
  })

  it('returns an empty document for unknown indices', () => {
    expect(mapFactToDoc('meristem-unknown-logs-v0', {})).toEqual({})
  })
})
