/**
 * 控制室工作台的内联 SVG 图标族。
 *
 * 归属边界：这些图标是 M-UI 拥有的展示资产，不承载任何事实或能力判断。
 * 摘要卡片区（ControlRoomSystemStatusZone）与未授权预览区
 * （ControlRoomGatedPreview）都需要同一套图标，因此提取到共享模块，
 * 避免在两个 zone 子组件中重复维护同一段 SVG 字面量。
 *
 * 图标统一使用 24x24 viewBox、较粗描边和填充强调色，
 * 以保证在截图尺度下仍然可辨识。
 */
export const SUMMARY_ICONS: Record<string, string> = {
  core: '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity="0.1"/><path d="M4 12h3l2.5-5 3.5 9 2.5-5H20"/></svg>',
  event:
    '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/><path d="M16 8a6 6 0 0 1 0 8M8 8a6 6 0 0 0 0 8M19.5 5a9.5 9.5 0 0 1 0 14M4.5 5a9.5 9.5 0 0 0 0 14"/></svg>',
  node: '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20c-4.5 0-8-3.5-8-8 0-5.5 4.5-9.5 8-11 3.5 1.5 8 5.5 8 11 0 4.5-3.5 8-8 8z" fill="currentColor" fill-opacity="0.12"/><path d="M12 6v14"/></svg>',
  policy:
    '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5l8.5 4v6.5c0 5.5-3.5 8.5-8.5 10.5-5-2-8.5-5-8.5-10.5V6.5l8.5-4z" fill="currentColor" fill-opacity="0.18"/><path d="m9 12 2.5 2.5L16 10"/></svg>',
  audit:
    '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5c-5 0-9 3.5-9 7s4 7 9 7 9-3.5 9-7-4-7-9-7z" fill="currentColor" fill-opacity="0.12"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/><path d="M20 12h1.5"/></svg>',
  preview:
    '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 22 7v10l-10 5-10-5V7l10-5z" fill="currentColor" fill-opacity="0.1"/></svg>'
}
