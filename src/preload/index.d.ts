import type { DshDesktopApi } from './index'

declare global {
  interface Window {
    dshDesktop: DshDesktopApi
  }
}

export {}
