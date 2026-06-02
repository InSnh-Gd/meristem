/**
 * Redact secret values from strings, objects, and errors.
 * Used across Timeline, Full Log, Audit, OpenSearch, UI errors, and CLI output.
 */

const SECRET_PATTERNS = [
  /("value"\s*:\s*)"[^"]*"/gi,
  /("value_ciphertext"\s*:\s*)"[^"]*"/gi,
  /("plaintext"\s*:\s*)"[^"]*"/gi,
  /(value=)\S+/gi,
  /(secret=)\S+/gi,
  /(token=)\S+/gi
]

export function redactSecrets(input: string): string {
  let result = input
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (_match, key: string) => `${key}[REDACTED]`)
  }
  return result
}

export function redactSecretsInObject<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj }
  for (const key of Object.keys(result)) {
    const value = result[key]
    const lowerKey = key.toLowerCase()
    if (
      typeof value === 'string' &&
      (lowerKey.includes('value') || lowerKey.includes('secret') || lowerKey.includes('token') || lowerKey.includes('password'))
    ) {
      result[key as keyof T] = '[REDACTED]' as T[keyof T]
    } else if (typeof value === 'object' && value !== null) {
      result[key as keyof T] = redactSecretsInObject(value as Record<string, unknown>) as T[keyof T]
    }
  }
  return result
}

export function redactSecretsInError(error: Error): Error {
  const redacted = new Error(redactSecrets(error.message))
  const stack = error.stack
  if (stack !== undefined) {
    redacted.stack = redactSecrets(stack)
  }
  redacted.name = error.name
  return redacted
}
