import { redirect } from '@sveltejs/kit'

/** 根路由重定向到控制室概览 */
export function load() {
  redirect(302, '/control-room')
}
