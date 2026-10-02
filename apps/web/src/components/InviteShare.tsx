import { Copy, MessageCircle, Send, Share2, ThumbsUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { inviteText, inviteUrl, shareTargets, type ShareTarget } from '../lib/invite';
import { t } from '../lib/i18n';
import { tokens } from '../lib/format';
import { useToast } from './ui';

const STYLE: Record<ShareTarget['id'], { cls: string; icon: ReactNode }> = {
  whatsapp: { cls: 'bg-[#25D366] text-white hover:brightness-95', icon: <MessageCircle className="size-5" /> },
  messenger: { cls: 'bg-[#0084FF] text-white hover:brightness-95', icon: <Send className="size-5" /> },
  facebook: { cls: 'bg-[#1877F2] text-white hover:brightness-95', icon: <ThumbsUp className="size-5" /> },
  more: { cls: 'bg-ink-900 text-white hover:bg-ink-800 dark:bg-white dark:text-ink-900', icon: <Share2 className="size-5" /> },
  copy: { cls: 'border border-ink-200 bg-white text-ink-900 hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900 dark:text-white', icon: <Copy className="size-5" /> },
};

/** Big, plain share buttons for a private room: WhatsApp, Messenger, Facebook, imo (phone share menu), copy. */
export function InviteShare({ code, host, gameName, stakeUnits }: { code: string; host: string; gameName: string; stakeUnits: number }) {
  const toast = useToast();
  const url = inviteUrl(code);
  const text = inviteText(host, gameName, tokens(stakeUnits), code);
  const act = async (target: ShareTarget) => {
    if (target.id === 'more') {
      try {
        await navigator.share({ title: 'PMT Arcade', text, url });
      } catch {
        // the player closed the share sheet
      }
    } else if (target.id === 'copy') {
      try {
        await navigator.clipboard.writeText(text);
        toast.success(t('Invite copied. Paste it to your friend.'));
      } catch {
        toast.error(url);
      }
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">{t('Invite your friends — they join with one tap:')}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {shareTargets(text, url).map((target) => {
          const s = STYLE[target.id];
          const cls = `flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition ${s.cls}`;
          return target.href ? (
            <a key={target.id} href={target.href} target="_blank" rel="noreferrer" className={cls}>
              {s.icon} {t(target.label)}
            </a>
          ) : (
            <button key={target.id} type="button" onClick={() => act(target)} className={cls}>
              {s.icon} {t(target.label)}
            </button>
          );
        })}
      </div>
      <p className="text-xs break-all text-ink-500">
        {t('Room link:')} <span className="font-mono">{url}</span>
      </p>
    </div>
  );
}
