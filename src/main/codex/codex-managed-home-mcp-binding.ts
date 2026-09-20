import { quotePosixShell } from '../../shared/wsl-login-shell-command'
import { parseWslUncPath } from '../../shared/wsl-paths'
import {
  createTomlLineScanState,
  getTomlTableHeader,
  isTomlStructuralLine,
  parseTomlSingleLineStringValue,
  updateTomlLineScanState
} from './config-toml-line-scan'
import { escapeTomlBasicString } from './config-toml-syntax'

export const MANAGED_CODEX_HOME_PLACEHOLDER = '{{ORCA_MANAGED_CODEX_HOME}}'

export function bindManagedCodexHomeInMcpHelpers(
  config: string,
  managedHomePath: string,
  platform: NodeJS.Platform = process.platform
): string {
  const lines = config.split('\n')
  let table = ''
  let scanState = createTomlLineScanState()
  const wslHome = parseWslUncPath(managedHomePath)?.linuxPath
  // cmd.exe quoting cannot be executed and verified on non-Windows hosts. Leave the
  // native placeholder unresolved rather than guess at a security boundary. A WSL
  // home is consumed by the POSIX shell and uses the verified path below.
  if (platform === 'win32' && !wslHome) {
    return config
  }
  const helperHome = quotePosixShell(wslHome ?? managedHomePath)

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (isTomlStructuralLine(scanState)) {
      const header = getTomlTableHeader(line)
      if (header) {
        table = header.trim().slice(1, -1).trim()
      } else if (/^mcp_servers(?:\.|$)/.test(table)) {
        lines[index] = bindHelperLine(line, helperHome)
      }
    }
    scanState = updateTomlLineScanState(scanState, line)
  }
  return lines.join('\n')
}

function bindHelperLine(line: string, helperHome: string): string {
  const match = /^\s*http_headers_helper\s*=/.exec(line)
  if (!match) {
    return line
  }
  const equalsIndex = line.indexOf('=', match.index)
  const parsed = parseTomlSingleLineStringValue(line, equalsIndex + 1)
  if (!parsed || !parsed.value.includes(MANAGED_CODEX_HOME_PLACEHOLDER)) {
    return line
  }
  // The replacement is a complete shell argument. Only replace a whitespace-delimited
  // bare token; injecting it inside quotes or another token changes shell syntax and can
  // execute metacharacters from the home path.
  const tokens = parsed.value.split(/(\s+)/)
  if (!tokens.includes(MANAGED_CODEX_HOME_PLACEHOLDER)) {
    return line
  }
  const bound = tokens
    .map((token) => (token === MANAGED_CODEX_HOME_PLACEHOLDER ? helperHome : token))
    .join('')
  return `${line.slice(0, parsed.start)}"${escapeTomlBasicString(bound)}"${line.slice(parsed.end)}`
}
