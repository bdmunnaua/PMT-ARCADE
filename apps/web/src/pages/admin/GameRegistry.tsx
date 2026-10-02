import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { formatMinor, hasPermission, parseTokenAmount, type GameDto } from '@arena/shared';
import { useAuth, useMe } from '../../auth/AuthProvider';
import { GameArt } from '../../components/Common';
import { Badge, Button, Card, Checkbox, DataTable, Input, Modal, Notice, PageHeader, Textarea, useToast } from '../../components/ui';
import { ApiError, patch } from '../../lib/api';
import { tokens } from '../../lib/format';
import { useApi, useDocumentTitle } from '../../lib/hooks';

export default function GameRegistry() {
  useDocumentTitle('Game registry');
  const me = useMe();
  const games = useApi<GameDto[]>('/api/admin/games');
  const [editing, setEditing] = useState<GameDto | null>(null);
  const canEdit = hasPermission(me.admin?.permissions, 'games.manage');
  return (
    <div className="space-y-4">
      <PageHeader title="Game registry" subtitle="Ten configurable slots. Names, descriptions, thumbnails and modules can change without touching wallet code." />
      <Notice tone="info">A game can be enabled in production only after its game module is installed in the API and its module key is set here. See docs/ADDING_A_GAME.md.</Notice>
      <Card>
        <DataTable
          rows={games.data}
          loading={games.loading}
          error={games.error}
          onRetry={games.reload}
          rowKey={(g) => g.id}
          columns={[
            { header: '', cell: (g) => <GameArt game={g} flat className="size-10 rounded-lg" />, className: 'w-14' },
            { header: 'Game', cell: (g) => <span><span className="font-semibold">{g.name}</span><span className="block text-xs text-ink-500">{g.slug}</span></span> },
            { header: 'Status', cell: (g) => (g.playable ? <Badge tone="success">Live</Badge> : g.maintenanceMode ? <Badge tone="warning">Maintenance</Badge> : g.enabled ? <Badge tone="warning">Enabled, not playable</Badge> : <Badge>Disabled</Badge>) },
            { header: 'Module', cell: (g) => (g.moduleKey ? <span className="font-mono text-xs">{g.moduleKey} {g.moduleInstalled ? '✓' : '(missing)'}</span> : <span className="text-ink-400">none</span>), hideOnMobile: true },
            { header: 'Stakes', cell: (g) => `${tokens(g.minimumStakeUnits)} – ${tokens(g.maximumStakeUnits)}`, hideOnMobile: true },
            { header: 'Players', cell: (g) => `${g.minimumPlayers}–${g.maximumPlayers}`, hideOnMobile: true },
            { header: 'Version', cell: (g) => g.gameVersion, hideOnMobile: true },
            { header: '', cell: (g) => canEdit && <Button size="sm" variant="outline" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(g)}>Edit</Button>, className: 'text-right' },
          ]}
        />
      </Card>
      {editing && <EditGame game={editing} onClose={() => setEditing(null)} onSaved={games.reload} />}
    </div>
  );
}

function EditGame({ game, onClose, onSaved }: { game: GameDto; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { config } = useAuth();
  const [f, setF] = useState({
    name: game.name,
    description: game.description,
    thumbnailUrl: game.thumbnailUrl ?? '',
    enabled: game.enabled,
    maintenanceMode: game.maintenanceMode,
    minStake: formatMinor(game.minimumStakeUnits).replace(/,/g, ''),
    maxStake: formatMinor(game.maximumStakeUnits).replace(/,/g, ''),
    minPlayers: String(game.minimumPlayers),
    maxPlayers: String(game.maximumPlayers),
    gameVersion: game.gameVersion,
    moduleKey: game.moduleKey ?? '',
    reason: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const minimumStakeUnits = parseTokenAmount(f.minStake);
    const maximumStakeUnits = parseTokenAmount(f.maxStake);
    if (!minimumStakeUnits || !maximumStakeUnits) return setError('Enter valid stake limits.');
    setBusy(true);
    setError(null);
    try {
      await patch(`/api/admin/games/${game.id}`, {
        reason: f.reason,
        changes: {
          name: f.name,
          description: f.description,
          thumbnailUrl: f.thumbnailUrl,
          enabled: f.enabled,
          maintenanceMode: f.maintenanceMode,
          minimumStakeUnits,
          maximumStakeUnits,
          minimumPlayers: Number(f.minPlayers),
          maximumPlayers: Number(f.maxPlayers),
          gameVersion: f.gameVersion,
          moduleKey: f.moduleKey,
        },
      });
      toast.success('Game updated.');
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${game.slug}`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy} disabled={f.reason.trim().length < 3}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Name" value={f.name} onChange={set('name')} />
        <Input label="Thumbnail URL" value={f.thumbnailUrl} onChange={set('thumbnailUrl')} placeholder="https://…" />
        <div className="sm:col-span-2">
          <Textarea label="Description" value={f.description} onChange={set('description')} rows={2} />
        </div>
        <Input label="Minimum stake (PMT)" value={f.minStake} onChange={set('minStake')} inputMode="decimal" />
        <Input label="Maximum stake (PMT)" value={f.maxStake} onChange={set('maxStake')} inputMode="decimal" />
        <Input label="Minimum players" type="number" min={2} max={16} value={f.minPlayers} onChange={set('minPlayers')} />
        <Input label="Maximum players" type="number" min={2} max={16} value={f.maxPlayers} onChange={set('maxPlayers')} />
        <Input label="Game version" value={f.gameVersion} onChange={set('gameVersion')} />
        <Input label="Module key" value={f.moduleKey} onChange={set('moduleKey')} hint="Must match an installed GameModule" className="font-mono" />
        <Checkbox label="Enabled" checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} hint={config?.isProduction ? 'Requires an installed module' : 'Development: allowed without a module (use the simulator)'} />
        <Checkbox label="Maintenance mode" checked={f.maintenanceMode} onChange={(v) => setF({ ...f, maintenanceMode: v })} hint="Blocks new matches for this game" />
        <div className="sm:col-span-2">
          <Textarea label="Reason for change (audit log)" value={f.reason} onChange={set('reason')} rows={2} required />
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-rose-600" role="alert">{error}</p>}
    </Modal>
  );
}
