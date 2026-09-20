import { quoteWindowsCmdArgument } from '../../shared/child-process/windows-command-line'
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
  const helperHome = wslHome
    ? quotePosixShell(wslHome)
    : platform === 'win32'
      ? quoteWindowsCmdArgument(managedHomePath)
      : quotePosixShell(managedHomePath)

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
  const bound = parsed.value.replaceAll(MANAGED_CODEX_HOME_PLACEHOLDER, helperHome)
  return `${line.slice(0, parsed.start)}"${escapeTomlBasicString(bound)}"${line.slice(parsed.end)}`
}
