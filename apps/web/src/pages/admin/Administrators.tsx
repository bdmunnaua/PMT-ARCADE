import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { ADMIN_ROLES, ROLE_LABELS, ROLE_PERMISSIONS, type AdminRole, type AdminUserDto } from '@arena/shared';
import { useMe } from '../../auth/AuthProvider';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, DataTable, Input, PageHeader, Select, useToast } from '../../components/ui';
import { patch, post } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { useApi, useDocumentTitle } from '../../lib/hooks';

export default function Administrators() {
  useDocumentTitle('Administrators');
  const me = useMe();
  const toast = useToast();
  const admins = useApi<AdminUserDto[]>('/api/admin/admins');
  const [playerNumber, setPlayerNumber] = useState('');
  const [role, setRole] = useState<AdminRole>('SUPPORT_ADMIN');
  const [assigning, setAssigning] = useState(false);
  const [edit, setEdit] = useState<{ admin: AdminUserDto; role?: AdminRole; active?: boolean } | null>(null);
  return (
    <div className="space-y-6">
      <PageHeader title="Administrators" subtitle="Roles are enforced by the API on every request. Changes are audited." />
      <Card>
        <CardHeader title="Grant a role" icon={<UserPlus className="size-4" />} subtitle="The person must already have a player account." />
        <CardBody>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setAssigning(true);
            }}
          >
            <Input label="Player #" value={playerNumber} onChange={(e) => setPlayerNumber(e.target.value.replace(/\D/g, ''))} inputMode="numeric" required />
            <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
              {ADMIN_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
            <Button type="submit" disabled={!playerNumber}>
              Grant role…
            </Button>
          </form>
          <p className="mt-3 text-xs text-ink-500">{ROLE_LABELS[role]}: {ROLE_PERMISSIONS[role].join(', ')}</p>
        </CardBody>
      </Card>
      <Card>
        <DataTable
          rows={admins.data}
          loading={admins.loading}
          error={admins.error}
          onRetry={admins.reload}
          rowKey={(a) => a.userId}
          columns={[
            { header: 'Admin', cell: (a) => <span><span className="font-semibold">#{a.playerNumber}</span> @{a.username} {a.userId === me.id && <Badge tone="brand">You</Badge>}</span> },
            { header: 'Email', cell: (a) => a.email ?? '—', hideOnMobile: true },
            { header: 'Role', cell: (a) => <Badge tone="brand">{ROLE_LABELS[a.role]}</Badge> },
            { header: 'Status', cell: (a) => (a.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>) },
            { header: 'Since', cell: (a) => dateTime(a.createdAt), hideOnMobile: true },
            {
              header: '',
              className: 'text-right',
              cell: (a) =>
                a.userId !== me.id && (
                  <span className="flex justify-end gap-1.5">
                    <Select aria-label="Change role" className="h-8 w-40 py-1 text-xs" value={a.role} onChange={(e) => setEdit({ admin: a, role: e.target.value as AdminRole })}>
                      {ADMIN_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </Select>
                    <Button size="sm" variant={a.active ? 'outline' : 'success'} onClick={() => setEdit({ admin: a, active: !a.active })}>
                      {a.active ? 'Deactivate' : 'Activate'}
                    </Button>
                  </span>
                ),
            },
          ]}
        />
      </Card>
      <ConfirmDialog
        open={assigning}
        onClose={() => setAssigning(false)}
        title="Grant administrator role"
        confirmLabel="Grant role"
        tone={role === 'SUPER_ADMIN' ? 'danger' : 'primary'}
        reasonLabel="Reason (audit log)"
        message={`Give Player #${playerNumber} the ${ROLE_LABELS[role]} role?`}
        onConfirm={async (reason) => {
          await post('/api/admin/admins', { playerNumber: Number(playerNumber), role, reason });
          toast.success('Role granted.');
          setPlayerNumber('');
          admins.reload();
        }}
      />
      <ConfirmDialog
        open={!!edit}
        onClose={() => setEdit(null)}
        title="Change administrator"
        confirmLabel="Save"
        tone="danger"
        reasonLabel="Reason (audit log)"
        message={edit ? (edit.role ? `Change #${edit.admin.playerNumber} to ${ROLE_LABELS[edit.role]}?` : `${edit.active ? 'Activate' : 'Deactivate'} #${edit.admin.playerNumber}?`) : ''}
        onConfirm={async (reason) => {
          await patch(`/api/admin/admins/${edit!.admin.userId}`, { role: edit!.role, active: edit!.active, reason });
          toast.success('Administrator updated.');
          admins.reload();
        }}
      />
    </div>
  );
}
