import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../../../core'
import type { OrchestrationDb, RunRow } from '../../../../orchestration/db'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import type { DispatchContextRow } from '../../../../orchestration/types'
import { createRootDispatch } from '../../../../orchestration/db/root-dispatch-test-fixture'
import { createOrchestrationRpcHarness } from '../rpc-test-harness'

// A lead is dispatched by a root coordinator and then coordinates its own Run from the same pane.
// That pane's `check` reads its own Run mailbox, so mail meant for it must land there.
describe('mail for a lead whose pane coordinates its own Run', () => {
  const h = createOrchestrationRpcHarness()
  const coordPane = 'tab_coord:11111111-1111-4111-8111-111111111111'
  const leadPane = 'tab_lead:22222222-2222-4222-9222-222222222222'
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let ctx: RpcContext
  let rootRun: RunRow
  let dispatch: DispatchContextRow

  afterEach(() => {
    h.cleanup()
  })

  function setup(): void {
    ;({ db, runtime, ctx } = h.setup(false))
    vi.spyOn(runtime, 'getTerminalPaneKey').mockImplementation((handle) =>
      handle === 'term_coord' ? coordPane : handle === 'term_lead' ? leadPane : null
    )
    rootRun = db.createRun({
      objective: 'root',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: coordPane
    })
    const task = db.createTask({ spec: 'lead the sub-project', runId: rootRun.id })
    dispatch = createRootDispatch(db, task.id, 'term_lead', leadPane)
  }

  function bindLeadRun(): RunRow {
    return db.createRun({
      objective: 'lead',
      coordinatorHandle: 'term_lead',
      coordinatorPaneKey: leadPane
    })
  }

  async function call(name: string, params: Record<string, unknown>) {
    return h.call(name, params, ctx)
  }

  async function leadInbox(params: Record<string, unknown> = {}) {
    return (await call('orchestration.check', { terminal: 'term_lead', ...params })) as {
      runId?: string
      deliveryId?: string | null
      messages: { subject: string }[]
      timedOut?: boolean
    }
  }

  it('routes dispatch:<id> mail to the Run the assignee pane now coordinates', async () => {
    setup()
    const leadRun = bindLeadRun()

    const result = (await call('orchestration.send', {
      from: 'term_coord',
      to: `dispatch:${dispatch.id}`,
      subject: 'Follow-up for the lead'
    })) as { message: { to_handle: string; run_id: string }; warnings?: { code: string }[] }

    expect(result.message.to_handle).toBe(`run:${leadRun.id}`)
    expect(result.message.run_id).toBe(leadRun.id)
    expect(result.warnings?.map((warning) => warning.code)).toContain(
      'recipient_run_bound_redirect'
    )
    const inbox = await leadInbox()
    expect(inbox.messages.map((message) => message.subject)).toEqual(['Follow-up for the lead'])
  })

  it('still reads dispatch mail that arrived before the pane bound its own Run', async () => {
    setup()
    db.insertMessage({
      from: 'term_coord',
      to: `dispatch:${dispatch.id}`,
      subject: 'Sent before the lead bound a Run',
      runId: rootRun.id
    })
    const leadRun = bindLeadRun()
    db.insertMessage({
      from: 'term_worker',
      to: `run:${leadRun.id}`,
      subject: 'Sub-worker report',
      runId: leadRun.id
    })

    const first = await leadInbox()
    expect(first.messages.map((message) => message.subject)).toEqual([
      'Sent before the lead bound a Run'
    ])
    expect(first.deliveryId).toBeTruthy()

    const second = await leadInbox({ ack: first.deliveryId })
    expect(second.messages.map((message) => message.subject)).toEqual(['Sub-worker report'])
  })

  it('delivers a reply to a Run-bound sender and wakes its waiting check', async () => {
    setup()
    const leadRun = bindLeadRun()
    const report = db.insertMessage({
      from: 'term_lead',
      to: `run:${rootRun.id}`,
      subject: 'Lead report',
      runId: rootRun.id
    })

    const waiting = leadInbox({ wait: true, timeoutMs: 2_000 })
    const reply = (await call('orchestration.reply', {
      id: report.id,
      from: 'term_coord',
      body: 'Decision'
    })) as { message: { to_handle: string; run_id: string } }

    expect(reply.message.to_handle).toBe(`run:${leadRun.id}`)
    expect(reply.message.run_id).toBe(leadRun.id)
    const woke = await waiting
    expect(woke.timedOut).toBe(false)
    expect(woke.messages.map((message) => message.subject)).toEqual(['Re: Lead report'])
  })

  it('keeps dispatch:<id> mail on the Dispatch mailbox while the assignee has no Run', async () => {
    setup()

    const result = (await call('orchestration.send', {
      from: 'term_coord',
      to: `dispatch:${dispatch.id}`,
      subject: 'Plain worker follow-up'
    })) as { message: { to_handle: string }; warnings?: unknown[] }

    expect(result.message.to_handle).toBe(`dispatch:${dispatch.id}`)
    expect(result.warnings).toBeUndefined()
  })

  it('keeps a reply on the raw handle when the sender has no Run or live pane', async () => {
    setup()
    const note = db.insertMessage({
      from: 'term_offline',
      to: `run:${rootRun.id}`,
      subject: 'Offline note',
      runId: rootRun.id
    })

    const reply = (await call('orchestration.reply', {
      id: note.id,
      from: 'term_coord',
      body: 'Ack'
    })) as { message: { to_handle: string; run_id: string } }

    expect(reply.message.to_handle).toBe('term_offline')
    expect(reply.message.run_id).toBe(rootRun.id)
  })
})
