import { cleanup } from '@testing-library/svelte'
import { afterEach } from 'vitest'

// ponytail: test-only polyfill — Svelte 5 transitions and Bits UI invoke the Web
// Animations API, which happy-dom does not implement. This class satisfies the
// structural shape of `Animation` strictly enough to avoid transition crashes
// without claiming browser runtime semantics.
class MockAnimation extends EventTarget implements Animation {
  // Event handler slots required by the Animation interface.
  public onfinish: Animation['onfinish'] = null
  public oncancel: Animation['oncancel'] = null

  // Timing / state fields — fixed at "finished" because happy-dom tests never
  // drive a real animation timeline.
  public currentTime: CSSNumberish | null = 0
  public effect: AnimationEffect | null = null
  public id: string = ''
  public playbackRate: number = 1
  public startTime: CSSNumberish | null = 0
  public timeline: AnimationTimeline | null = null

  // Read-only derived state, captured once at construction.
  private readonly finishedPromise: Promise<Animation>
  private readonly readyPromise: Promise<Animation>

  constructor() {
    super()
    this.finishedPromise = Promise.resolve<Animation>(this)
    this.readyPromise = Promise.resolve<Animation>(this)
  }

  get finished(): Promise<Animation> {
    return this.finishedPromise
  }

  get ready(): Promise<Animation> {
    return this.readyPromise
  }

  get pending(): boolean {
    return false
  }

  get playState(): AnimationPlayState {
    return 'finished'
  }

  // No-op lifecycle methods — happy-dom never schedules frames.
  cancel(): void {}
  finish(): void {}
  pause(): void {}
  play(): void {}
  reverse(): void {}
  commitStyles(): void {}
  persist(): void {}
  updatePlaybackRate(_playbackRate: number): void {}
}

if (typeof Element !== 'undefined' && !Element.prototype.animate) {
  Element.prototype.animate = () => {
    return new MockAnimation()
  }
}

afterEach(() => {
  cleanup()
})
