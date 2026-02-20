// GUID: LIB_VERSION-000-v12
// [Intent] Single source of truth for the application version number displayed in the UI.
//          Must always match the version in package.json (Golden Rule #2).
// [Inbound Trigger] Imported by the About page, Login page footer, and any component displaying
//                   the app version.
// [Downstream Impact] Changing this value updates the version displayed on all pages.
//                     Must be kept in sync with package.json — mismatch indicates a build/deploy issue.

// GUID: LIB_VERSION-001-v12
// [Intent] Export the current application version string for UI display and build verification.
//          This constant is checked post-deployment to verify version consistency (Golden Rule #2).
// [Inbound Trigger] Referenced by About page and Login page to render version in the UI.
// [Downstream Impact] Post-push verification compares this value against what is rendered on the
//                     deployed About and Login pages. A stale value here means deployment verification fails.
// Single source of truth for app version
// IMPORTANT: Update this when you bump the version in package.json
export const APP_VERSION = "1.58.33";
