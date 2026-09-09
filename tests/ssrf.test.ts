/**
 * SSRF GUARD — webhook URL policy tests.
 *
 * Registration must accept only public HTTPS endpoints: loopback,
 * link-local (cloud metadata), RFC1918, CGNAT, unique-local/link-local
 * IPv6, IP-literal and DNS-resolved private targets are rejected.
 * Unresolvable hostnames are rejected fail-closed.
 */
import { describe, expect, it } from 'vitest'
import { assertSafeWebhookUrl } from '@/lib/ssrf'

const rejected = async (url: string) => {
  const result = await assertSafeWebhookUrl(url)
  expect(result.ok, `expected rejection: ${url}`).toBe(false)
  expect(result.reason, `rejection carries a reason: ${url}`).toBeTruthy()
}

const accepted = async (url: string) => {
  const result = await assertSafeWebhookUrl(url)
  expect(result.ok, `expected acceptance: ${url}`).toBe(true)
}

describe('ssrf · protocol and shape', () => {
  it('rejects non-HTTPS, malformed URLs, userinfo and oversized URLs', async () => {
    await rejected('http://example.com/hook')
    await rejected('not a url')
    await rejected('')
    await rejected('https://user:pass@example.com/hook')
    await rejected(`https://example.com/${'a'.repeat(2100)}`)
  })
})

describe('ssrf · hostname and IP-literal policy', () => {
  it('rejects localhost and unspecified hosts', async () => {
    await rejected('https://localhost/hook')
    await rejected('https://api.localhost/hook')
    await rejected('https://0.0.0.0/hook')
    await rejected('https://[::]/hook')
  })

  it('rejects loopback, link-local (metadata), RFC1918 and CGNAT IPv4', async () => {
    await rejected('https://127.0.0.1/hook')
    await rejected('https://127.8.8.8/hook')
    await rejected('https://169.254.169.254/latest/meta-data')
    await rejected('https://169.254.1.1/hook')
    await rejected('https://10.0.0.1/hook')
    await rejected('https://192.168.1.5/hook')
    await rejected('https://172.16.0.1/hook')
    await rejected('https://172.31.255.255/hook')
    await rejected('https://100.64.1.1/hook')
    // public IPv4 literals are fine
    await accepted('https://93.184.216.34/hook')
  })

  it('rejects private IPv6 forms including IPv4-mapped', async () => {
    await rejected('https://[::1]/hook')
    await rejected('https://[fc00::1]/hook')
    await rejected('https://[fd12::1]/hook')
    await rejected('https://[fe80::1]/hook')
    await rejected('https://[::ffff:10.0.0.1]/hook')
  })
})

describe('ssrf · DNS resolution policy (fail-closed)', () => {
  it('rejects unresolvable hostnames instead of failing open', async () => {
    await rejected('https://this-domain-cannot-exist.invalid/hook')
  })

  it('rejects a public hostname that RESOLVES into a private range (DNS rebinding vector)', async () => {
    // nip.io maps <ip>.nip.io → <ip>; 10.0.0.1.nip.io resolves to 10.0.0.1
    await rejected('https://10.0.0.1.nip.io/hook')
    await rejected('https://169.254.169.254.nip.io/latest/meta-data')
  })

  it('accepts real public HTTPS hosts', async () => {
    await accepted('https://example.com/hook')
    await accepted('https://github.com/webhooks')
  })
})
