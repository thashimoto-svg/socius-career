import { RequireAuth } from "@/components/require-auth";

// Onboarding sits outside the (main) tab shell but is still signed-in-only:
// its answers are written to the student's own user document.
export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RequireAuth>{children}</RequireAuth>;
}
