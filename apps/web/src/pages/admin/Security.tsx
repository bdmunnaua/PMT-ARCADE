import { useState } from 'react';
import { Link } from 'react-router';
import { FRAUD_FLAG_STATUSES, hasPermission, LOGIN_EVENT_TYPES, type AuditLogDto, type FraudFlagDto, type FraudFlagStatus, type LoginEventDto } from '@arena/shared';
import { useMe } from '../../auth/AuthProvider';
import { Button, Card, ConfirmDialog, DataTable, FilterBar, Input, Modal, PageHeader, Pagination, Select, StatusBadge, useToast } from '../../components/ui';
import { post } from '../../lib/api';
import { dateTime, human } from '../../lib/format';
import { useDocumentTitle, usePaged } from '../../lib/hooks';

export function FraudFlagsPage() {
  useDocumentTitle('Fraud flags');
  const me = useMe();
  const toast = useToast();
  const [status, setStatus] = useState<string>('OPEN');
  const [target, setTarget] = useState<{ flag: FraudFlagDto; status: FraudFlagStatus } | null>(null);
  const list = usePaged<FraudFlagDto>('/api/admin/fraud-flags', { status: status || undefined });
  const canManage = hasPermission(me.admin?.permissions, 'risk.manage');
  return (
    <div>
      <PageHeader title="Fraud flags" subtitle="Automatic risk signals for human review. Flags never ban or restrict anyone on their own." />
      <Card>
        <FilterBar>
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {FRAUD_FLAG_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </FilterBar>
        <DataTable
          rows={list.data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          rowKey={(f) => f.id}
          empty={{ title: 'No flags', description: 'Nothing needs review.' }}
          columns={[
            { header: 'Raised', cell: (f) => dateTime(f.createdAt) },
            { header: 'Player', cell: (f) => (f.playerNumber ? <Link className="font-semibold text-brand-600" to={`/admin/players/${f.playerNumber}`}>#{f.playerNumber}</Link> : '—') },
            { header: 'Signal', cell: (f) => human(f.type) },
            { header: 'Severity', cell: (f) => <StatusBadge status={f.severity} /> },
            { header: 'Details', cell: (f) => <code className="block max-w-xs truncate text-xs text-ink-500">{JSON.stringify(f.details)}</code>, hideOnMobile: true },
            { header: 'Status', cell: (f) => <StatusBadge status={f.status} /> },
            {
              header: '',
              className: 'text-right',
              cell: (f) =>
                canManage &&
                f.status === 'OPEN' && (
                  <span className="flex justify-end gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => setTarget({ flag: f, status: 'DISMISSED' })}>Dismiss</Button>
                    <Button size="sm" variant="outline" onClick={() => setTarget({ flag: f, status: 'REVIEWED' })}>Reviewed</Button>
                    <Button size="sm" variant="danger" onClick={() => setTarget({ flag: f, status: 'CONFIRMED' })}>Confirm</Button>
                  </span>
                ),
            },
          ]}
        />
        <Pagination page={list.page} hasMore={!!list.data?.hasMore} onPage={list.setPage} />
      </Card>
      <ConfirmDialog
        open={!!target}
        onClose={() => setTarget(null)}
        title={`Mark flag as ${target?.status.toLowerCase()}`}
        confirmLabel="Save"
        reasonLabel="Review note (audit log)"
        message="Confirming a flag does not change the account. Use the player page to restrict or suspend if needed."
        onConfirm={async (note) => {
          await post(`/api/admin/fraud-flags/${target!.flag.id}/status`, { status: target!.status, note });
          toast.success('Flag updated.');
          list.reload();
        }}
      />
    </div>
  );
}

export function LoginActivityPage() {
  useDocumentTitle('Login activity');
  const [type, setType] = useState('');
  const [player, setPlayer] = useState('');
  const list = usePaged<LoginEventDto>('/api/admin/login-activity', { type: type || undefined, playerNumber: player || undefined });
  return (
    <div>
      <PageHeader title="Login activity" subtitle="Sign-ins, registrations, failed tokens and denied admin access. Kept for 180 days." />
      <Card>
        <FilterBar>
          <Select label="Event" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All</option>
            {LOGIN_EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {human(t)}
              </option>
            ))}
          </Select>
          <Input label="Player #" value={player} onChange={(e) => setPlayer(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
        </FilterBar>
        <DataTable
          rows={list.data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          rowKey={(e) => e.id}
          empty={{ title: 'No events' }}
          columns={[
            { header: 'Time', cell: (e) => dateTime(e.createdAt) },
            { header: 'Event', cell: (e) => <StatusBadge status={e.eventType} /> },
            { header: 'Player', cell: (e) => (e.playerNumber ? `#${e.playerNumber}` : '—') },
            { header: 'IP', cell: (e) => <span className="font-mono text-xs">{e.ip ?? '—'}</span> },
            { header: 'Country', cell: (e) => e.country ?? '—', hideOnMobile: true },
            { header: 'Detail', cell: (e) => <span className="text-xs text-ink-500">{e.detail ?? ''}</span>, hideOnMobile: true },
            { header: 'Device', cell: (e) => <span className="block max-w-xs truncate text-xs text-ink-500">{e.userAgent ?? ''}</span>, hideOnMobile: true },
          ]}
        />
        <Pagination page={list.page} hasMore={!!list.data?.hasMore} onPage={list.setPage} />
      </Card>
    </div>
  );
}

export function AuditLogsPage() {
  useDocumentTitle('Audit logs');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [open, setOpen] = useState<AuditLogDto | null>(null);
  const list = usePaged<AuditLogDto>('/api/admin/audit', { action: action || undefined, entityType: entityType || undefined });
  return (
    <div>
      <PageHeader title="Audit logs" subtitle="Append-only record of every important administrative action." />
      <Card>
        <FilterBar>
          <Input label="Action starts with" value={action} onChange={(e) => setAction(e.target.value.trim())} placeholder="buy. / sell. / settings." />
          <Select label="Entity" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            <option value="">All</option>
            {['buy_request', 'sell_request', 'player', 'match', 'dispute', 'game', 'platform_settings', 'admin_user', 'wallet', 'ledger', 'fraud_flag'].map((t) => (
              <option key={t} value={t}>
                {human(t)}
              </option>
            ))}
          </Select>
        </FilterBar>
        <DataTable
          rows={list.data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          rowKey={(a) => a.id}
          onRowClick={setOpen}
          empty={{ title: 'No audit entries' }}
          columns={[
            { header: 'Time', cell: (a) => dateTime(a.createdAt) },
            { header: 'Admin', cell: (a) => a.adminLabel ?? 'System' },
            { header: 'Action', cell: (a) => <span className="font-mono text-xs">{a.action}</span> },
            { header: 'Entity', cell: (a) => `${human(a.entityType)}${a.entityId ? ` · ${a.entityId.slice(0, 10)}…` : ''}`, hideOnMobile: true },
            { header: 'Reason', cell: (a) => <span className="block max-w-xs truncate">{a.reason ?? '—'}</span>, hideOnMobile: true },
          ]}
        />
        <Pagination page={list.page} hasMore={!!list.data?.hasMore} onPage={list.setPage} />
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.action ?? ''} size="lg">
        {open && (
          <div className="space-y-3 text-sm">
            <p>
              <strong>{open.adminLabel ?? 'System'}</strong> · {dateTime(open.createdAt)} · request {open.requestId}
            </p>
            <p>IP {open.ip ?? '—'} · {open.userAgent ?? ''}</p>
            {open.reason && <p>Reason: {open.reason}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <pre className="overflow-auto rounded-xl bg-ink-50 p-3 text-xs dark:bg-ink-850">Before{'\n'}{JSON.stringify(open.before, null, 2)}</pre>
              <pre className="overflow-auto rounded-xl bg-ink-50 p-3 text-xs dark:bg-ink-850">After{'\n'}{JSON.stringify(open.after, null, 2)}</pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
