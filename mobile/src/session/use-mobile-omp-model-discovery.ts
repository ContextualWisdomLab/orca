import { useEffect, useState } from 'react'
import { z } from 'zod'
import type { CatalogModel } from '../../../src/shared/agent-session-option-catalog'
import type { RpcClient } from '../transport/rpc-client'

const discoveryResult = z.object({
  success: z.literal(true),
  catalogOrigin: z.literal('probe'),
  models: z.array(
    z.object({ id: z.string().min(1), label: z.string(), description: z.string().optional() })
  )
})

/** The runtime resolves the workspace's execution host, including SSH and folder workspaces. */
export function useMobileOmpModelDiscovery(args: {
  client: Pick<RpcClient, 'sendRequest'> | null
  hostId: string
  worktreeId: string
  enabled: boolean
}): CatalogModel[] | null {
  const { client, hostId, worktreeId, enabled } = args
  const scope = JSON.stringify([hostId, worktreeId])
  const [result, setResult] = useState<{
    client: typeof client
    scope: string
    models: CatalogModel[]
  } | null>(null)
  useEffect(() => {
    if (!enabled || !client || !worktreeId) {
      return
    }
    let cancelled = false
    void client
      .sendRequest('git.discoverCommitMessageModels', {
        worktree: `id:${worktreeId}`,
        agentId: 'omp'
      })
      .then((value) => {
        const parsed = discoveryResult.safeParse(value)
        // Older hosts may return static fallback models; they are not configured OMP choices.
        if (!cancelled && parsed.success) {
          setResult({
            client,
            scope,
            models: parsed.data.models.map((model) => ({ ...model, options: [] }))
          })
        }
      })
      .catch(() => {
        // Discovery failure leaves the authoritative hook model available.
      })
    return () => {
      cancelled = true
    }
  }, [client, enabled, scope, worktreeId])
  return enabled && result?.client === client && result?.scope === scope ? result.models : null
}
