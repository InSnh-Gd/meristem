import { redirect } from '@sveltejs/kit'

/** 根路由重定向到 Phase 14 控制室概览 */
export function load() {
  redirect(302, '/control-room')
}
