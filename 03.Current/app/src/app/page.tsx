// GUID: PAGE_ROOT-000-v03
// [Intent] Root page component — renders the login page as the application entry point.
//          Delegates entirely to LoginPage (PAGE_LOGIN-002).
// [Inbound Trigger] User navigates to / (root URL).
// [Downstream Impact] Renders LoginPage which handles authentication flow.

import LoginPage from "./(auth)/login/page";

// GUID: PAGE_ROOT-001-v03
// [Intent] Default export that renders LoginPage as the home page content.
// [Inbound Trigger] Next.js routes / to this page component.
// [Downstream Impact] Full delegation to PAGE_LOGIN-002. No additional logic.
export default function Home() {
  return <LoginPage />;
}
