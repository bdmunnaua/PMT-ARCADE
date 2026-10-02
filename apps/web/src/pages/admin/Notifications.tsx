import { NotificationList } from '../../components/NotificationList';
import { PageHeader } from '../../components/ui';
import { useDocumentTitle } from '../../lib/hooks';

export default function AdminNotifications() {
  useDocumentTitle('Admin notifications');
  return (
    <div>
      <PageHeader title="Notifications" subtitle="New requests, finance chat messages, disputes, risk flags and large transactions." />
      <NotificationList audience="admin" />
    </div>
  );
}
