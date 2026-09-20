import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { parseTomlSingleLineStringValue } from './config-toml-line-scan'
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

  it('round-trips only bare placeholder arguments through a real POSIX shell', () => {
    const home = "/tmp/Account's $(printf injected) `printf backtick` $files/home"
    const helpers = {
      bare: `printf '[%s]' ${MANAGED_CODEX_HOME_PLACEHOLDER}`,
      doubleQuoted: `printf '[%s]' "${MANAGED_CODEX_HOME_PLACEHOLDER}"`,
      singleQuoted: `printf '[%s]' '${MANAGED_CODEX_HOME_PLACEHOLDER}'`,
      embedded: `printf '[%s]' prefix${MANAGED_CODEX_HOME_PLACEHOLDER}suffix`
    }

    for (const [context, helper] of Object.entries(helpers)) {
      const input = `[mcp_servers.probe]\nhttp_headers_helper = ${JSON.stringify(helper)}\n`
      const output = bindManagedCodexHomeInMcpHelpers(input, home, 'darwin')
      const line = output.split('\n')[1] ?? ''
      const parsed = parseTomlSingleLineStringValue(line, line.indexOf('=') + 1)
      expect(parsed, context).not.toBeNull()
      const stdout = execFileSync('/bin/sh', ['-c', parsed?.value ?? ''], { encoding: 'utf8' })

      expect(stdout, context).toBe(
        context === 'bare'
          ? `[${home}]`
          : context === 'embedded'
            ? `[prefix${MANAGED_CODEX_HOME_PLACEHOLDER}suffix]`
            : `[${MANAGED_CODEX_HOME_PLACEHOLDER}]`
      )
      if (context !== 'bare') {
        expect(output, context).toBe(input)
      }
    }
  })

  it('leaves Windows helper binding unresolved without a verified command-shell boundary', () => {
    const home = "C:\\Users\\Account's %PATH% $(printf injected) `printf backtick`"
    expect(bindManagedCodexHomeInMcpHelpers(config, home, 'win32')).toBe(config)
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
