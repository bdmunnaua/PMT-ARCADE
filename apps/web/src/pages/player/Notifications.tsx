import { NotificationList } from '../../components/NotificationList';
import { PageHeader } from '../../components/ui';
import { useDocumentTitle } from '../../lib/hooks';

export default function NotificationsPage() {
  useDocumentTitle('Notifications');
  return (
    <div>
      <PageHeader title="Notifications" />
      <NotificationList audience="player" />
    </div>
  );
}
