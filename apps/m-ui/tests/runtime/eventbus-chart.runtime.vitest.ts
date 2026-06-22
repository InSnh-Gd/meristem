import process from 'node:process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import EventBusSubjectHealthChart from '../../src/lib/components/modules/control-room/EventBusSubjectHealthChart.svelte'
import type { EventBusSubjectMetric } from '../../src/lib/types.ts'

// vitest runs with cwd = apps/m-ui so a root-reachable project path is stable here.
const CHART_SOURCE = readFileSync(
  join(process.cwd(), 'src/lib/components/modules/control-room/EventBusSubjectHealthChart.svelte'),
  'utf8'
)

function metricSubject(
  subject: string,
  success: number,
  rejected: number,
  failed: number
): EventBusSubjectMetric {
  return {
    subject,
    success,
    rejected,
    failed,
    retryAttempts: 0
  }
}

describe('EventBusSubjectHealthChart', () => {
  it('keeps its types local to the M-UI surface and does not deep-import packages/contracts', () => {
    // 该组件的所有契约类型必须经本地 $lib/types.ts 的 UI 面向别名消费，
    // 不得穿透到 packages/contracts 的相对路径。这是 M-UI 源边界契约。
    expect(CHART_SOURCE).not.toMatch(/packages\/contracts/)
  })

  it('renders one row per subject with numeric counts — status not color-only', () => {
    const subjects: EventBusSubjectMetric[] = [
      metricSubject('node.registered', 12, 1, 0),
      metricSubject('task.submitted', 4, 2, 3)
    ]

    render(EventBusSubjectHealthChart, { props: { subjects } })

    const chart = screen.getByTestId('eventbus-chart')
    expect(chart).toBeTruthy()
    expect(chart.getAttribute('aria-label')).toMatch(/EventBus/)

    // Both subjects listed with numeric counts (Chinese labels).
    expect(screen.getByText('node.registered')).toBeTruthy()
    expect(screen.getByText('task.submitted')).toBeTruthy()
    expect(screen.getByText('成功 12 · 拒绝 1 · 失败 0')).toBeTruthy()
    expect(screen.getByText('成功 4 · 拒绝 2 · 失败 3')).toBeTruthy()

    // Row is also accessible to assistive tech via aria-label.
    expect(chart.querySelectorAll('li[aria-label]').length).toBe(2)
  })

  it('renders visible empty state when subjects list is empty', () => {
    render(EventBusSubjectHealthChart, { props: { subjects: [] } })

    expect(screen.queryByTestId('eventbus-chart')).toBeNull()
    expect(screen.getByTestId('eventbus-chart-empty').textContent).toMatch(/没有发布 subject 指标/)
  })

  it('renders a row with "无数据" placeholder when a subject has zero totals', () => {
    // ponytail: a subject window with no publish outcomes must not crash and must
    // not render an invisible bar — show the "无数据" marker and zero counts.
    const subjects: EventBusSubjectMetric[] = [metricSubject('node.silent', 0, 0, 0)]

    render(EventBusSubjectHealthChart, { props: { subjects } })

    expect(screen.getByText('node.silent')).toBeTruthy()
    expect(screen.getByText('无数据')).toBeTruthy()
    expect(screen.getByText('成功 0 · 拒绝 0 · 失败 0')).toBeTruthy()
  })

  it('caps rendered rows to eight even when more subjects are present', () => {
    // ponytail: a bounded pilot — not a general charting framework. Cap rows so
    // one runaway subject list cannot balloon the control-room panel.
    const subjects: EventBusSubjectMetric[] = Array.from({ length: 12 }, (_, i) =>
      metricSubject(`subject.${i}`, i + 1, 0, 0)
    )

    render(EventBusSubjectHealthChart, { props: { subjects } })

    const rows = screen.getByTestId('eventbus-chart').querySelectorAll('li[aria-label]')
    expect(rows.length).toBe(8)
  })
})
