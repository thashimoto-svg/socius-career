import { redirect } from "next/navigation";

// Entry point. First-time users land on onboarding.
// TODO(firebase): once auth + `users/{uid}.onboardingCompleted` exist, send
// returning users straight to /chat and only new users to /onboarding.
export default function Home() {
  redirect("/onboarding");
}
