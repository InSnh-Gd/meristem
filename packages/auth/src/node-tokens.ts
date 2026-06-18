export function mintNodeToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  const suffix = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `mnt_${crypto.randomUUID().replaceAll('-', '')}_${suffix}`
}

export async function hashNodeToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
