import { describe, expect, it } from 'bun:test'
import {
  redactSecrets,
  redactSecretsInError,
  redactSecretsInObject
} from '../../../packages/common/src/secret-redaction.ts'

describe('secret redaction helpers', () => {
  it('redactSecrets redacts value JSON fields', () => {
    expect(redactSecrets('{"value":"plain-text","other":"safe"}')).toBe(
      '{"value":[REDACTED],"other":"safe"}'
    )
    expect(redactSecrets('{ "value" : "plain-text" }')).toBe('{ "value" : [REDACTED] }')
  })

  it('redactSecrets redacts token assignment patterns', () => {
    expect(redactSecrets('token=abc123 next=safe')).toBe('token=[REDACTED] next=safe')
    expect(redactSecrets('TOKEN=abc123')).toBe('TOKEN=[REDACTED]')
  })

  it('redactSecrets redacts secret assignment patterns', () => {
    expect(redactSecrets('secret=abc123 next=safe')).toBe('secret=[REDACTED] next=safe')
    expect(redactSecrets('SECRET=abc123')).toBe('SECRET=[REDACTED]')
  })

  it('redactSecrets passes non-secret strings through unchanged', () => {
    const input = 'status=ok user=operator message="healthy"'

    expect(redactSecrets(input)).toBe(input)
  })

  it('redactSecretsInObject redacts value, secret, and token keys', () => {
    expect(
      redactSecretsInObject({
        value: 'plain-text',
        secret: 'top-secret',
        token: 'token-value'
      })
    ).toEqual({
      value: '[REDACTED]',
      secret: '[REDACTED]',
      token: '[REDACTED]'
    })
  })

  it('redactSecretsInObject redacts nested objects recursively', () => {
    expect(
      redactSecretsInObject({
        id: 'safe',
        nested: {
          apiToken: 'abc123',
          child: {
            password: 'passw0rd',
            label: 'kept'
          }
        }
      })
    ).toEqual({
      id: 'safe',
      nested: {
        apiToken: '[REDACTED]',
        child: {
          password: '[REDACTED]',
          label: 'kept'
        }
      }
    })
  })

  it('redactSecretsInObject preserves non-sensitive keys', () => {
    const input = { id: 'node-1', count: 2, enabled: true, empty: null }

    expect(redactSecretsInObject(input)).toEqual(input)
  })

  it('redactSecretsInError redacts error messages', () => {
    const error = new Error('request failed token=abc123')

    expect(redactSecretsInError(error).message).toBe('request failed token=[REDACTED]')
  })

  it('redactSecretsInError redacts stack traces', () => {
    const error = new Error('request failed')
    error.stack = 'Error: request failed\n    at call (file.ts:1:1) secret=abc123'

    expect(redactSecretsInError(error).stack).toBe(
      'Error: request failed\n    at call (file.ts:1:1) secret=[REDACTED]'
    )
  })

  it('redactSecretsInError preserves error names', () => {
    const error = new TypeError('bad value=abc123')

    expect(redactSecretsInError(error).name).toBe('TypeError')
  })

  it('redactSecretsInError leaves non-sensitive messages unchanged', () => {
    const error = new Error('request failed with public status')

    expect(redactSecretsInError(error).message).toBe('request failed with public status')
  })
})
