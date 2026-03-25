import type { SessionStatus } from "../../entities/domain";
import { t } from "../i18n";

interface StatusBadgeProps {
  status: SessionStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return <span className={`status-badge status-badge--${status}`}>{t(`status.${status}`)}</span>;
}
