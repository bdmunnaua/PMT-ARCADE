import { NotificationList } from '../../components/NotificationList';
import { PageHeader } from '../../components/ui';
import { useDocumentTitle } from '../../lib/hooks';
import { t } from '../../lib/i18n';

export default function NotificationsPage() {
  useDocumentTitle(t("Notifications"));
  return (
    <div>
      <PageHeader title={t("Notifications")} />
      <NotificationList audience="player" />
    </div>
  );
}
