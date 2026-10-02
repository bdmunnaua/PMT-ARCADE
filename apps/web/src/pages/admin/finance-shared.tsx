import { Link } from 'react-router';
import { AlertTriangle } from 'lucide-react';
import { TX_CATEGORY_LABELS, type AdminFinanceContextDto, type PlayerSummaryDto } from '@arena/shared';
import { Amount } from '../../components/Common';
import { Card, CardBody, CardHeader, KeyValue, Notice, StatusBadge } from '../../components/ui';
import { bdt, dateTime, human, percentFromBps, tokens } from '../../lib/format';

export function PlayerSummaryCard({ player }: { player: PlayerSummaryDto }) {
  return (
    <Card>
      <CardHeader title="Player" actions={<StatusBadge status={player.accountStatus} />} />
      <CardBody>
        <KeyValue
          items={[
            ['Player', <Link to={`/admin/players/${player.playerNumber}`} className="font-semibold text-brand-600">#{player.playerNumber}</Link>],
            ['Name', `${player.displayName} (@${player.username})`],
            ['Account age', `${player.accountAgeDays} days`],
            ['Joined', dateTime(player.createdAt)],
          ]}
        />
      </CardBody>
    </Card>
  );
}

/** Wallet, risk flags, history and match summary shown next to every buy/sell decision. */
export function FinanceContext({ ctx }: { ctx: AdminFinanceContextDto }) {
  return (
    <div className="space-y-4">
      {ctx.riskFlags.length > 0 && (
        <Notice tone="danger" title={`${ctx.riskFlags.length} open risk flag${ctx.riskFlags.length > 1 ? 's' : ''}`}>
          <ul className="mt-1 space-y-1">
            {ctx.riskFlags.map((f) => (
              <li key={f.id} className="flex items-center gap-2">
                <AlertTriangle className="size-3.5" /> {human(f.type)} · {f.severity.toLowerCase()} · {dateTime(f.createdAt)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs opacity-80">Signals only — review before deciding. Nothing is blocked automatically.</p>
        </Notice>
      )}
      {ctx.senderNumberAccountCount !== undefined && ctx.senderNumberAccountCount > 1 && (
        <Notice tone="warning">This sender number has been used by {ctx.senderNumberAccountCount} different accounts.</Notice>
      )}
      <Card>
        <CardHeader title="Current wallet" />
        <CardBody>
          <KeyValue
            items={[
              ['Available', tokens(ctx.wallet.availableUnits)],
              ['Locked in games', tokens(ctx.wallet.lockedGameUnits)],
              ['Pending sell', tokens(ctx.wallet.lockedSellUnits)],
              ['Bonus', tokens(ctx.wallet.bonusUnits)],
            ]}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="History" />
        <CardBody>
          <KeyValue
            items={[
              ['Buy requests', `${ctx.previousBuys.count} total · ${ctx.previousBuys.completedCount} completed`],
              ['Bought (completed)', bdt(ctx.previousBuys.completedPoisha)],
              ['Sell requests', `${ctx.previousSells.count} total · ${ctx.previousSells.completedCount} completed`],
              ['Paid out (completed)', bdt(ctx.previousSells.completedPoisha)],
              ['Matches', `${ctx.matchSummary.gamesPlayed} played · ${ctx.matchSummary.wins}W ${ctx.matchSummary.losses}L ${ctx.matchSummary.draws}D`],
              ['Win rate', percentFromBps(ctx.matchSummary.winRateBps)],
            ]}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Recent transactions" />
        <ul className="divide-y divide-ink-100 dark:divide-ink-800">
          {ctx.recentTransactions.length === 0 && <li className="px-5 py-4 text-sm text-ink-500">None</li>}
          {ctx.recentTransactions.map((t) => (
            <li key={t.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
              <span>
                {TX_CATEGORY_LABELS[t.category]} <span className="text-xs text-ink-500">· {dateTime(t.createdAt)}</span>
              </span>
              <Amount units={t.netUnits} signed />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
