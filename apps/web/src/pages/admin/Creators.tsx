import { useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { hasPermission, type CreatorInfoDto, type CreatorSubmissionDto, type Paginated } from '@arena/shared';
import { useMe } from '../../auth/AuthProvider';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Notice, PageHeader, PageLoader, Pagination, Select, StatCard, useToast } from '../../components/ui';
import { post } from '../../lib/api';
import { dateTime, tokens } from '../../lib/format';
import { useDocumentTitle, usePaged } from '../../lib/hooks';

type List = Paginated<CreatorSubmissionDto> & { info: CreatorInfoDto };
const TONE = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger' } as const;

/** Creator rewards: check each post, then approve (pays bonus PMT) or reject with a reason. */
export default function CreatorsPage() {
  useDocumentTitle('Creator rewards');
  const me = useMe();
  const toast = useToast();
  const [status, setStatus] = useState('PENDING');
  const list = usePaged<CreatorSubmissionDto>('/api/admin/creators', { status: status || undefined });
  const data = list.data as List | null;
  const [approving, setApproving] = useState<CreatorSubmissionDto | null>(null);
  const [rejecting, setRejecting] = useState<CreatorSubmissionDto | null>(null);
  const canPay = hasPermission(me.admin?.permissions, 'finance.distribute');
  const info = data?.info;
  return (
    <div className="space-y-6">
      <PageHeader title="Creator rewards" subtitle="Players who made an ORIGINAL post about PMT Arcade. Open the post, check it is real, original, shows pmtarcade.com and is marked as a paid partnership / reward — then approve or reject." />
      {info && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Reward per creator" value={`${info.rewardTokens.toLocaleString('en-US')} PMT`} hint="bonus PMT from the rewards pool" />
          <StatCard label="Approved" value={`${info.approved} / ${info.maxCreators}`} tone="emerald" />
          <StatCard label="Places left" value={info.remaining} tone="amber" />
        </div>
      )}
      <Notice tone="info">Never approve posts that only ask for likes, follows or shares. Check the risk line: several accounts from the same network, or no real games, usually means one person with many accounts.</Notice>
      <div className="w-48">
        <Select label="Show" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="PENDING">Waiting</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="">All</option>
        </Select>
      </div>
      {list.loading && !data ? (
        <PageLoader />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : !data?.items.length ? (
        <EmptyState title="Nothing here" />
      ) : (
        <div className="space-y-4">
          {data.items.map((s) => {
            const risky = (s.risk?.sameIpAccounts ?? 0) > 0 || (s.risk?.gamesPlayed ?? 0) < 3;
            return (
              <Card key={s.id} className="space-y-3 p-5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={TONE[s.status]}>{s.status.toLowerCase()}</Badge>
                  <Badge tone="neutral">{s.platform.toLowerCase()}</Badge>
                  <strong>@{s.socialHandle}</strong>
                  {s.sender && (
                    <Link to={`/admin/players/${s.sender.userId}`} className="text-brand-600 hover:underline">
                      #{s.sender.playerNumber} @{s.sender.username}
                    </Link>
                  )}
                  <span className="text-ink-500">{s.sender?.email}</span>
                  <span className="ml-auto text-xs text-ink-500">{dateTime(s.createdAt)}</span>
                </div>
                <a href={s.postUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-brand-600 hover:underline">
                  {s.postUrl} <ExternalLink className="size-3.5 shrink-0" />
                </a>
                <p className={risky ? 'flex items-center gap-1.5 text-amber-700 dark:text-amber-300' : 'text-ink-500'}>
                  {risky && <AlertTriangle className="size-4" />}
                  Risk: {s.risk?.sameIpAccounts ?? 0} other account(s) on the same network · {s.risk?.gamesPlayed ?? 0} game(s) played · account since {dateTime(s.sender?.createdAt)}
                </p>
                {s.reviewNote && <p className="text-ink-500">Note: {s.reviewNote}</p>}
                {s.status === 'APPROVED' && s.rewardUnits !== null && <p className="text-emerald-700 dark:text-emerald-300">Paid {tokens(s.rewardUnits)} on {dateTime(s.reviewedAt)}</p>}
                {s.status === 'PENDING' && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={!canPay} onClick={() => setApproving(s)}>
                      Approve and pay
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setRejecting(s)}>
                      Reject
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
          <Pagination page={list.page} hasMore={!!data.hasMore} onPage={list.setPage} />
        </div>
      )}
      <ConfirmDialog
        open={!!approving}
        onClose={() => setApproving(null)}
        title="Approve this post and pay the reward?"
        confirmLabel={`Pay ${(info?.rewardTokens ?? 0).toLocaleString('en-US')} PMT`}
        message="The reward is paid as bonus PMT from the rewards pool. This cannot be undone."
        onConfirm={async () => {
          await post(`/api/admin/creators/${approving!.id}/approve`, {});
          toast.success('Approved — reward paid.');
          list.reload();
        }}
      />
      <ConfirmDialog
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title="Reject this post?"
        confirmLabel="Reject"
        tone="danger"
        reasonLabel="Reason (the player sees it)"
        message="The player is told why. They cannot submit again in this campaign."
        onConfirm={async (note) => {
          await post(`/api/admin/creators/${rejecting!.id}/reject`, { note });
          toast.success('Rejected.');
          list.reload();
        }}
      />
    </div>
  );
}
