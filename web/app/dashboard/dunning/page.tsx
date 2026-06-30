'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'

interface Sequence {
  id: string
  name: string
  channel: string
  assigned_codes: string[]
  is_active: boolean
  metrics?: Record<string, unknown> | null
  created_at?: string
}

interface Step {
  id: string
  sequence_id: string
  step_order: number
  delay_hours: number
  channel: string
  subject: string
  body: string
}

interface SequenceDetail {
  sequence: Sequence
  steps: Step[]
}

interface PreviewResult {
  steps: Array<{ subject: string; body: string }>
}

const CHANNELS = ['email', 'sms', 'in_app', 'push', 'webhook']

function channelTone(c: string): 'emerald' | 'sky' | 'violet' | 'amber' | 'slate' {
  switch (c) {
    case 'email':
      return 'sky'
    case 'sms':
      return 'emerald'
    case 'in_app':
      return 'violet'
    case 'push':
      return 'amber'
    default:
      return 'slate'
  }
}

function delayLabel(hours: number): string {
  if (hours <= 0) return 'Immediately'
  if (hours < 24) return `${hours}h after start`
  const days = Math.round((hours / 24) * 10) / 10
  return `${days}d after start`
}

export default function DunningPage() {
  const [sequences, setSequences] = useState<Sequence[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SequenceDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // sequence create/edit modal
  const [seqModal, setSeqModal] = useState(false)
  const [seqEdit, setSeqEdit] = useState<Sequence | null>(null)
  const [seqName, setSeqName] = useState('')
  const [seqChannel, setSeqChannel] = useState('email')
  const [seqCodes, setSeqCodes] = useState('')
  const [seqActive, setSeqActive] = useState(true)
  const [savingSeq, setSavingSeq] = useState(false)

  // step create/edit modal
  const [stepModal, setStepModal] = useState(false)
  const [stepEdit, setStepEdit] = useState<Step | null>(null)
  const [stepOrder, setStepOrder] = useState(1)
  const [stepDelay, setStepDelay] = useState(24)
  const [stepChannel, setStepChannel] = useState('email')
  const [stepSubject, setStepSubject] = useState('')
  const [stepBody, setStepBody] = useState('')
  const [savingStep, setSavingStep] = useState(false)

  async function loadSequences(selectAfter?: string) {
    setLoading(true)
    setError(null)
    try {
      const list = (await api.getDunningSequences()) as Sequence[]
      const arr = Array.isArray(list) ? list : []
      setSequences(arr)
      const next = selectAfter ?? selectedId ?? arr[0]?.id ?? null
      if (next) {
        setSelectedId(next)
        await loadDetail(next)
      } else {
        setSelectedId(null)
        setDetail(null)
        setPreview(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sequences')
    } finally {
      setLoading(false)
    }
  }

  async function loadDetail(id: string) {
    setDetailLoading(true)
    setPreview(null)
    try {
      const d = (await api.getDunningSequence(id)) as SequenceDetail
      setDetail(d ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sequence detail')
    } finally {
      setDetailLoading(false)
    }
  }

  useEffect(() => {
    loadSequences()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function selectSequence(id: string) {
    setSelectedId(id)
    setPreview(null)
    loadDetail(id)
  }

  async function runPreview() {
    if (!selectedId) return
    setPreviewLoading(true)
    setError(null)
    try {
      const p = (await api.previewDunningSequence(selectedId)) as PreviewResult
      setPreview(p ?? { steps: [] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      setPreviewLoading(false)
    }
  }

  // ---- sequence modal ----
  function openCreateSeq() {
    setSeqEdit(null)
    setSeqName('')
    setSeqChannel('email')
    setSeqCodes('')
    setSeqActive(true)
    setSeqModal(true)
  }

  function openEditSeq(s: Sequence) {
    setSeqEdit(s)
    setSeqName(s.name)
    setSeqChannel(s.channel || 'email')
    setSeqCodes((s.assigned_codes || []).join(', '))
    setSeqActive(!!s.is_active)
    setSeqModal(true)
  }

  async function saveSeq() {
    setSavingSeq(true)
    setError(null)
    const codes = seqCodes
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)
    const body = { name: seqName.trim(), channel: seqChannel, assigned_codes: codes, is_active: seqActive }
    try {
      if (seqEdit) {
        await api.updateDunningSequence(seqEdit.id, body)
        setSeqModal(false)
        await loadSequences(seqEdit.id)
      } else {
        const created = (await api.createDunningSequence(body)) as Sequence
        setSeqModal(false)
        await loadSequences(created?.id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save sequence')
    } finally {
      setSavingSeq(false)
    }
  }

  async function deleteSeq(s: Sequence) {
    if (!confirm(`Delete sequence "${s.name}"? This removes all its steps.`)) return
    setError(null)
    try {
      await api.deleteDunningSequence(s.id)
      const remaining = sequences.filter((x) => x.id !== s.id)
      setSelectedId(remaining[0]?.id ?? null)
      await loadSequences(remaining[0]?.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete sequence')
    }
  }

  // ---- step modal ----
  function openCreateStep() {
    if (!detail) return
    setStepEdit(null)
    setStepOrder((detail.steps?.length ?? 0) + 1)
    setStepDelay(24)
    setStepChannel(detail.sequence.channel || 'email')
    setStepSubject('')
    setStepBody('')
    setStepModal(true)
  }

  function openEditStep(st: Step) {
    setStepEdit(st)
    setStepOrder(st.step_order)
    setStepDelay(st.delay_hours)
    setStepChannel(st.channel || 'email')
    setStepSubject(st.subject || '')
    setStepBody(st.body || '')
    setStepModal(true)
  }

  async function saveStep() {
    if (!selectedId) return
    setSavingStep(true)
    setError(null)
    const body = {
      step_order: Number(stepOrder),
      delay_hours: Number(stepDelay),
      channel: stepChannel,
      subject: stepSubject,
      body: stepBody,
    }
    try {
      if (stepEdit) {
        await api.updateDunningStep(stepEdit.id, body)
      } else {
        await api.addDunningStep(selectedId, body)
      }
      setStepModal(false)
      setPreview(null)
      await loadDetail(selectedId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save step')
    } finally {
      setSavingStep(false)
    }
  }

  async function deleteStep(st: Step) {
    if (!selectedId) return
    if (!confirm('Delete this step?')) return
    setError(null)
    try {
      await api.deleteDunningStep(st.id)
      setPreview(null)
      await loadDetail(selectedId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete step')
    }
  }

  if (loading) return <PageSpinner label="Loading dunning sequences..." />

  const steps = (detail?.steps ?? []).slice().sort((a, b) => a.step_order - b.step_order)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Dunning Sequences</h1>
          <p className="mt-1 text-sm text-slate-400">
            Build multi-step recovery outreach, assign decline codes, and preview rendered messages.
          </p>
        </div>
        <Button onClick={openCreateSeq}>New sequence</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {sequences.length === 0 ? (
        <EmptyState
          title="No dunning sequences yet"
          description="Create a sequence to start orchestrating recovery outreach across email, SMS, and in-app channels."
          action={<Button onClick={openCreateSeq}>Create your first sequence</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
          {/* Sequence list */}
          <div className="space-y-2">
            {sequences.map((s) => {
              const active = s.id === selectedId
              return (
                <button
                  key={s.id}
                  onClick={() => selectSequence(s.id)}
                  className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                    active
                      ? 'border-emerald-500/50 bg-emerald-500/10'
                      : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-slate-100">{s.name}</span>
                    <Badge tone={s.is_active ? 'emerald' : 'slate'}>{s.is_active ? 'active' : 'paused'}</Badge>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge tone={channelTone(s.channel)}>{s.channel}</Badge>
                    <span className="text-xs text-slate-500">{(s.assigned_codes || []).length} code(s)</span>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Detail / builder */}
          <div className="space-y-4">
            {detailLoading ? (
              <Card>
                <CardBody>
                  <Spinner label="Loading sequence..." />
                </CardBody>
              </Card>
            ) : detail ? (
              <>
                <Card>
                  <CardHeader className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-white">{detail.sequence.name}</h2>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Badge tone={channelTone(detail.sequence.channel)}>{detail.sequence.channel}</Badge>
                        {(detail.sequence.assigned_codes || []).map((c) => (
                          <Badge key={c} tone="slate">
                            {c}
                          </Badge>
                        ))}
                        {(detail.sequence.assigned_codes || []).length === 0 && (
                          <span className="text-xs text-slate-500">No assigned codes</span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => openEditSeq(detail.sequence)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => deleteSeq(detail.sequence)}>
                        Delete
                      </Button>
                    </div>
                  </CardHeader>
                </Card>

                <Card>
                  <CardHeader className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-white">Steps ({steps.length})</h3>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={runPreview} disabled={previewLoading || steps.length === 0}>
                        {previewLoading ? <Spinner /> : 'Preview'}
                      </Button>
                      <Button size="sm" onClick={openCreateStep}>
                        Add step
                      </Button>
                    </div>
                  </CardHeader>
                  <CardBody>
                    {steps.length === 0 ? (
                      <EmptyState
                        title="No steps yet"
                        description="Add steps with delays, channels, and message content to define the cadence."
                        action={<Button size="sm" onClick={openCreateStep}>Add first step</Button>}
                      />
                    ) : (
                      <ol className="space-y-3">
                        {steps.map((st, i) => (
                          <li key={st.id} className="relative rounded-lg border border-slate-800 bg-slate-950/40 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="flex items-start gap-3">
                                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-semibold text-emerald-400">
                                  {st.step_order ?? i + 1}
                                </div>
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge tone={channelTone(st.channel)}>{st.channel}</Badge>
                                    <span className="text-xs text-slate-500">{delayLabel(st.delay_hours)}</span>
                                  </div>
                                  <div className="mt-1.5 text-sm font-medium text-slate-100">
                                    {st.subject || <span className="text-slate-500">(no subject)</span>}
                                  </div>
                                  <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-slate-400">
                                    {st.body}
                                  </p>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <Button size="sm" variant="ghost" onClick={() => openEditStep(st)}>
                                  Edit
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => deleteStep(st)}>
                                  Delete
                                </Button>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </CardBody>
                </Card>

                {preview && (
                  <Card>
                    <CardHeader>
                      <h3 className="text-sm font-semibold text-white">Rendered preview</h3>
                      <p className="mt-0.5 text-xs text-slate-500">Each step rendered with sample variables.</p>
                    </CardHeader>
                    <CardBody>
                      {preview.steps.length === 0 ? (
                        <p className="text-sm text-slate-500">Nothing to preview.</p>
                      ) : (
                        <div className="space-y-3">
                          {preview.steps.map((p, i) => (
                            <div key={i} className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
                              <div className="text-xs uppercase tracking-wide text-slate-500">Step {i + 1}</div>
                              <div className="mt-1 text-sm font-semibold text-slate-100">{p.subject}</div>
                              <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm text-slate-300">
                                {p.body}
                              </pre>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardBody>
                  </Card>
                )}
              </>
            ) : (
              <Card>
                <CardBody>
                  <p className="text-sm text-slate-500">Select a sequence to view its steps.</p>
                </CardBody>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* Sequence modal */}
      <Modal
        open={seqModal}
        onClose={() => setSeqModal(false)}
        title={seqEdit ? 'Edit sequence' : 'New sequence'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSeqModal(false)}>
              Cancel
            </Button>
            <Button onClick={saveSeq} disabled={savingSeq || !seqName.trim()}>
              {savingSeq ? <Spinner /> : 'Save'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Name</label>
            <input
              value={seqName}
              onChange={(e) => setSeqName(e.target.value)}
              placeholder="Hard-decline recovery"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Default channel
            </label>
            <select
              value={seqChannel}
              onChange={(e) => setSeqChannel(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Assigned decline codes (comma-separated)
            </label>
            <input
              value={seqCodes}
              onChange={(e) => setSeqCodes(e.target.value)}
              placeholder="insufficient_funds, expired_card"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={seqActive}
              onChange={(e) => setSeqActive(e.target.checked)}
              className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
            />
            Active
          </label>
        </div>
      </Modal>

      {/* Step modal */}
      <Modal
        open={stepModal}
        onClose={() => setStepModal(false)}
        title={stepEdit ? 'Edit step' : 'Add step'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setStepModal(false)}>
              Cancel
            </Button>
            <Button onClick={saveStep} disabled={savingStep}>
              {savingStep ? <Spinner /> : 'Save'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Order</label>
              <input
                type="number"
                min={1}
                value={stepOrder}
                onChange={(e) => setStepOrder(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Delay (hours)
              </label>
              <input
                type="number"
                min={0}
                value={stepDelay}
                onChange={(e) => setStepDelay(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Channel</label>
            <select
              value={stepChannel}
              onChange={(e) => setStepChannel(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Subject</label>
            <input
              value={stepSubject}
              onChange={(e) => setStepSubject(e.target.value)}
              placeholder="Your payment didn't go through"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Body (supports variables like {'{{customer_name}}'})
            </label>
            <textarea
              value={stepBody}
              onChange={(e) => setStepBody(e.target.value)}
              rows={5}
              placeholder="Hi {{customer_name}}, we couldn't process your last payment of {{amount}}..."
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
