<script lang="ts">
  import { getOidcLoginUrl } from '$lib/bff'

  let { returnTo = '/control-room', compact = false } = $props<{
    returnTo?: string
    compact?: boolean
  }>()
</script>

<div class:compact class="oidc-login-stub" data-testid="oidc-login-stub">
  {#if !compact}
    <p class="eyebrow">Meristem 身份验证</p>
    <h1>通过组织账号进入控制室</h1>
    <p class="description">认证由 BFF 的受保护会话处理；此浏览器不会接收或保存 OIDC token。</p>
  {/if}
  <a class="login-action" data-testid="oidc-login-link" href={getOidcLoginUrl(returnTo)}>
    使用组织账号登录
  </a>
</div>

<style>
  .oidc-login-stub {
    display: grid;
    gap: var(--space-3);
    max-width: 560px;
    padding: var(--space-5);
    border: 1px solid var(--line-chrome-strong);
    border-radius: var(--control-radius);
    background: var(--surface-glass);
  }

  .oidc-login-stub.compact {
    display: flex;
    max-width: none;
    padding: 0;
    border: 0;
    background: transparent;
  }

  .eyebrow {
    margin: 0;
    color: var(--text-60);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  h1,
  .description {
    margin: 0;
  }

  h1 {
    color: var(--text-100);
    font-size: var(--text-xl);
  }

  .description {
    color: var(--text-60);
    line-height: var(--lh-normal);
  }

  .login-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: fit-content;
    min-height: 34px;
    padding: 0 var(--space-3);
    border: 1px solid var(--signal-info);
    border-radius: var(--radius-pill);
    background: var(--surface-chrome-raised);
    color: var(--text-100);
    font-size: var(--text-sm);
    font-weight: var(--fw-medium);
    text-decoration: none;
  }

  .login-action:hover,
  .login-action:focus-visible {
    border-color: var(--accent-purple);
    background: var(--surface-raised);
  }
</style>
