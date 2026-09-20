import { describe, expect, it } from 'vitest'
import {
  MANAGED_CODEX_HOME_PLACEHOLDER,
  bindManagedCodexHomeInMcpHelpers
} from './codex-managed-home-mcp-binding'

describe('managed Codex MCP helper binding', () => {
  const config = [
    '[mcp_servers.time]',
    'url = "https://time.invalid/mcp"',
    `http_headers_helper = "python headers.py --runtime-dir /run --home ${MANAGED_CODEX_HOME_PLACEHOLDER}"`,
    '',
    '[mcp_servers.other]',
    'command = "other-server"',
    'args = ["--keep", "unchanged"]',
    ''
  ].join('\n')

  it('binds each managed account home without changing unrelated MCP config', () => {
    const first = bindManagedCodexHomeInMcpHelpers(config, '/data/codex-accounts/one/home')
    const second = bindManagedCodexHomeInMcpHelpers(config, '/data/codex-accounts/two/home')

    expect(first).toContain("--home '/data/codex-accounts/one/home'")
    expect(second).toContain("--home '/data/codex-accounts/two/home'")
    expect(first).not.toContain('/data/codex-accounts/two/home')
    expect(first).toContain(
      '[mcp_servers.other]\ncommand = "other-server"\nargs = ["--keep", "unchanged"]'
    )
  })

  it('quotes literal helper arguments and leaves unbound helpers untouched', () => {
    const home = "/data/Account's $files/home"
    const bound = bindManagedCodexHomeInMcpHelpers(config, home, 'darwin')
    expect(bound).toContain("--home '/data/Account'\\\\''s $files/home'")

    const ordinary = '[mcp_servers.docs]\nhttp_headers_helper = "print-headers"\n'
    expect(bindManagedCodexHomeInMcpHelpers(ordinary, home, 'darwin')).toBe(ordinary)
  })

  it('does not interpolate lookalikes outside MCP helper fields', () => {
    const input = [
      `note = "${MANAGED_CODEX_HOME_PLACEHOLDER}"`,
      '[mcp_servers.time]',
      `url = "https://example.invalid/${MANAGED_CODEX_HOME_PLACEHOLDER}"`,
      `http_headers_helper = "helper ${MANAGED_CODEX_HOME_PLACEHOLDER}"`,
      ''
    ].join('\n')
    const bound = bindManagedCodexHomeInMcpHelpers(input, '/managed/home')

    expect(bound).toContain(`note = "${MANAGED_CODEX_HOME_PLACEHOLDER}"`)
    expect(bound).toContain(`url = "https://example.invalid/${MANAGED_CODEX_HOME_PLACEHOLDER}"`)
    expect(bound).toContain('http_headers_helper = "helper \'/managed/home\'"')
  })
})
