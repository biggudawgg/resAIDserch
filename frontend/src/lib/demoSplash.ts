const SEEN_KEY = 'resaidserch.demo-splash-seen'

/** Show the demo splash once per browser session. Storage can be blocked (private mode, previews), so fail open. */
export function shouldShowDemoSplash(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) !== '1'
  } catch {
    return true
  }
}

export function markDemoSplashSeen() {
  try {
    sessionStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* storage unavailable: the splash just shows again next load */
  }
}
