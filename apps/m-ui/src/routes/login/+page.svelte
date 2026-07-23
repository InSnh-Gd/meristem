<script lang="ts">
  import OidcLoginStub from '$lib/components/ui/OidcLoginStub.svelte'
</script>

<svelte:head>
  <title>登录 | Meristem</title>
</svelte:head>

<section class="login-route" aria-label="组织账号登录">
  <OidcLoginStub />
</section>

<style>
  .login-route {
    display: grid;
    min-height: min(64vh, 560px);
    place-items: center;
  }
</style>
