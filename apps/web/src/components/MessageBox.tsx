import { useState } from 'react';
import { Send } from 'lucide-react';
import type { PlayerMessageDto } from '@arena/shared';
import { Badge, Button, Card, CardBody, CardHeader, Select, Textarea, useToast } from './ui';
import { ApiError, post } from '../lib/api';
import { dateTime } from '../lib/format';
import { useApi } from '../lib/hooks';
import { t } from '../lib/i18n';

export const MESSAGE_CATEGORY_LABELS: Record<PlayerMessageDto['category'], string> = {
  ADVICE: 'Advice / idea',
  REQUEST: 'Request',
  PROBLEM: 'Problem',
  OTHER: 'Other',
};
const STATUS_TONE = { NEW: 'info', READ: 'neutral', REPLIED: 'success', CLOSED: 'neutral' } as const;

/** "Send us a message": advice, a request, a problem — and the team's replies. */
export function MessageBox() {
  const toast = useToast();
  const mine = useApi<PlayerMessageDto[]>('/api/me/messages');
  const [category, setCategory] = useState<PlayerMessageDto['category']>('ADVICE');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await post('/api/me/messages', { category, body });
      setBody('');
      toast.success(t('Thank you! Your message was sent to the PMT Arcade team.'));
      mine.reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('Could not send. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title={t('Send us a message')} subtitle={t('Advice, an idea, a request or a problem — the team reads every message and replies here.')} icon={<Send className="size-4" />} />
      <CardBody className="space-y-3">
        <Select label={t('Type')} value={category} onChange={(e) => setCategory(e.target.value as PlayerMessageDto['category'])}>
          {(Object.keys(MESSAGE_CATEGORY_LABELS) as PlayerMessageDto['category'][]).map((c) => (
            <option key={c} value={c}>
              {t(MESSAGE_CATEGORY_LABELS[c])}
            </option>
          ))}
        </Select>
        <Textarea label={t('Your message')} value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={2000} placeholder={t('Write your message…')} />
        <Button icon={<Send className="size-4" />} disabled={busy || body.trim().length < 5} onClick={send}>
          {t('Send message')}
        </Button>
        <p className="text-xs text-ink-500">{t('Never write your password, bKash PIN or OTP in a message.')}</p>
      </CardBody>
      {!!mine.data?.length && (
        <ul className="divide-y divide-ink-100 border-t border-ink-100 dark:divide-ink-800 dark:border-ink-800">
          {mine.data.map((m) => (
            <li key={m.id} className="space-y-2 px-5 py-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">{t(MESSAGE_CATEGORY_LABELS[m.category])}</Badge>
                <Badge tone={STATUS_TONE[m.status]}>{t(m.status === 'REPLIED' ? 'Replied' : m.status === 'CLOSED' ? 'Closed' : 'Sent')}</Badge>
                <span className="text-xs text-ink-500">{dateTime(m.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap">{m.body}</p>
              {m.adminReply && (
                <div className="rounded-xl bg-brand-50 p-3 dark:bg-brand-500/10">
                  <p className="mb-1 text-xs font-semibold text-brand-700 dark:text-brand-300">
                    {t('PMT Arcade team')} · {dateTime(m.repliedAt)}
                  </p>
                  <p className="whitespace-pre-wrap">{m.adminReply}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
