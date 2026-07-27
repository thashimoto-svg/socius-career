import type { Metadata } from "next";
import { ComingSoon, LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "利用規約 | Socius Career",
};

export default function TermsPage() {
  return (
    <LegalPage title="利用規約">
      <ComingSoon />
    </LegalPage>
  );
}
