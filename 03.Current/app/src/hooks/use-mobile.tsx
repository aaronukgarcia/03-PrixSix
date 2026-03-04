// GUID: HOOK_USE_MOBILE-000-v01
// [Intent] React hook that returns true when the viewport width is below the 768px mobile breakpoint; updates reactively on resize via MediaQueryList change events.
// [Inbound Trigger] Used by components that need to adapt layout or behaviour for mobile screens (e.g. sidebar collapse, touch-friendly controls).
// [Downstream Impact] Returns undefined on initial SSR render; callers must handle the undefined→boolean transition.
import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
