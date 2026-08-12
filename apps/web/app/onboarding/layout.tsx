import { RequireAuth } from "@/components/require-auth";

// Onboarding sits outside the (main) tab shell but is still signed-in-only:
// its answers are written to the student's own user document.
//
// It is also one of the two places that waits for that document. Every chip on
// the screen is prefilled from the saved profile through `useState`, which
// reads its initial value once — render before the profile lands and a student
// revisiting the screen is shown the defaults, and saving would overwrite what
// they picked last time with them.
export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RequireAuth waitForProfile>{children}</RequireAuth>;
}
