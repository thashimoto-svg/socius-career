import { T } from "@/lib/theme";

type ChipProps = {
  label: string;
  active?: boolean;
  onClick?: () => void;
};

/** Selectable pill used for onboarding choices. */
export function Chip({ label, active = false, onClick }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "8px 14px",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 500,
        border: `1.5px solid ${active ? T.primary : T.line}`,
        background: active ? T.primarySoft : T.paper,
        color: active ? T.primary : T.sub,
      }}
    >
      {label}
    </button>
  );
}
