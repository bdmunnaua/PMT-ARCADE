import { useState } from 'react';
import { Link } from 'react-router';
import type { Paginated, PlayerMessageDto } from '@arena/shared';
import { MESSAGE_CATEGORY_LABELS } from '../../components/MessageBox';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, PageLoader, Pagination, Select, Textarea, useToast } from '../../components/ui';
import { ApiError, post } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { useDocumentTitle, usePaged } from '../../lib/hooks';

type List = Paginated<PlayerMessageDto> & { counts: Record<string, number> };
const STATUS_TONE = { NEW: 'info', READ: 'neutral', REPLIED: 'success', CLOSED: 'neutral' } as const;

/** Messages players sent to the team: who sent it, what they wrote, and the reply. */
export default function MessagesPage() {
  useDocumentTitle('Messages');
  const toast = useToast();
  const [status, setStatus] = useState('NEW');
  const list = usePaged<PlayerMessageDto>('/api/admin/messages', { status: status || undefined });
  const data = list.data as List | null;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done);
      list.reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Something went wrong.');
    }
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Messages" subtitle="Advice, requests and problems sent by players from the Support page. Replies appear on the player's Support page and as a notification." />
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Select label="Show" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="NEW">New ({data?.counts.NEW ?? 0})</option>
            <option value="READ">Read ({data?.counts.READ ?? 0})</option>
            <option value="REPLIED">Replied ({data?.counts.REPLIED ?? 0})</option>
            <option value="CLOSED">Closed ({data?.counts.CLOSED ?? 0})</option>
            <option value="">All</option>
          </Select>
        </div>
      </div>
      {list.loading && !data ? (
        <PageLoader />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : !data?.items.length ? (
        <EmptyState title="No messages here" />
      ) : (
        <div className="space-y-4">
          {data.items.map((m) => (
            <Card key={m.id} className="space-y-3 p-5">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone="neutral">{MESSAGE_CATEGORY_LABELS[m.category]}</Badge>
                <Badge tone={STATUS_TONE[m.status]}>{m.status.toLowerCase()}</Badge>
                {m.sender && (
                  <Link to={`/admin/players/${m.sender.userId}`} className="font-semibold text-brand-600 hover:underline">
                    #{m.sender.playerNumber} @{m.sender.username}
                  </Link>
                )}
                <span className="text-ink-500">
                  {m.sender?.displayName} {m.sender?.email ? `· ${m.sender.email}` : ''}
                </span>
                <span className="ml-auto text-xs text-ink-500">{dateTime(m.createdAt)}</span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{m.body}</p>
              {m.adminReply && (
                <div className="rounded-xl bg-brand-50 p-3 text-sm dark:bg-brand-500/10">
                  <p className="mb-1 text-xs font-semibold">Your reply · {dateTime(m.repliedAt)}</p>
                  <p className="whitespace-pre-wrap">{m.adminReply}</p>
                </div>
              )}
              <Textarea label={m.adminReply ? 'Send another reply' : 'Reply'} rows={2} value={drafts[m.id] ?? ''} onChange={(e) => setDrafts({ ...drafts, [m.id]: e.target.value })} maxLength={2000} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={(drafts[m.id] ?? '').trim().length < 2} onClick={() => act(() => post(`/api/admin/messages/${m.id}/reply`, { reply: drafts[m.id] }).then(() => setDrafts({ ...drafts, [m.id]: '' })), 'Reply sent.')}>
                  Send reply
                </Button>
                {m.status === 'NEW' && (
                  <Button size="sm" variant="outline" onClick={() => act(() => post(`/api/admin/messages/${m.id}/status`, { status: 'READ' }), 'Marked as read.')}>
                    Mark as read
                  </Button>
                )}
                {m.status !== 'CLOSED' && (
                  <Button size="sm" variant="ghost" onClick={() => act(() => post(`/api/admin/messages/${m.id}/status`, { status: 'CLOSED' }), 'Closed.')}>
                    Close
                  </Button>
                )}
              </div>
            </Card>
          ))}
          <Pagination page={list.page} hasMore={!!data.hasMore} onPage={list.setPage} />
        </div>
      )}
    </div>
  );
}
