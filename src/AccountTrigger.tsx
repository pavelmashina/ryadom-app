import { Bell, UserRound } from "lucide-react";
import { IconButton } from "./components";

export default function AccountTrigger({
  hasPendingRequests,
  onClick,
}: {
  hasPendingRequests: boolean;
  onClick: () => void;
}) {
  return (
    <IconButton
      label={hasPendingRequests
        ? "Аккаунт: есть запросы на присоединение к питомцу"
        : "Аккаунт"}
      className="account-trigger"
      onClick={onClick}
    >
      <UserRound aria-hidden="true" />
      {hasPendingRequests && (
        <span className="account-notification-bell" aria-hidden="true">
          <Bell />
        </span>
      )}
    </IconButton>
  );
}
