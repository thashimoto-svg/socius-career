import { redirect } from "next/navigation";

// Entry point. First-time users land on onboarding.
// TODO(supabase): once auth + a `profiles.onboarded_at` column exist, send
// returning users straight to /chat and only new users to /onboarding.
export default function Home() {
  redirect("/onboarding");
}
