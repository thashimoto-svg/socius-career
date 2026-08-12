import type { Metadata } from "next";
import { ComingSoon, LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "プライバシーポリシー | Socius Career",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="プライバシーポリシー">
      <ComingSoon />
    </LegalPage>
  );
}
