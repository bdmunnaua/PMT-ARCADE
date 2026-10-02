import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import clsx from 'clsx';
import type { ChatMessageDto, FinanceRequestKind } from '@arena/shared';
import { ApiError, get, post } from '../lib/api';
import { dateTime } from '../lib/format';
import { useRealtime } from '../lib/realtime';
import { Button, Card, CardHeader, EmptyState, Spinner } from './ui';
import { t } from '../lib/i18n';

/**
 * Private chat attached to a buy/sell request. `side` decides which API is used:
 * players → /api/wallet/…, admins → /api/admin/…. Messages can't be edited or deleted.
 */
export function ChatPanel({ kind, requestId, side, canSend = true }: { kind: FinanceRequestKind; requestId: string; side: 'PLAYER' | 'ADMIN'; canSend?: boolean }) {
  const base = `${side === 'PLAYER' ? '/api/wallet' : '/api/admin'}/${kind === 'BUY' ? 'buy' : 'sell'}-requests/${requestId}/messages`;
  const [messages, setMessages] = useState<ChatMessageDto[] | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setMessages(await get<ChatMessageDto[]>(base));
      await post(`${base}/read`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Could not load messages."));
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [messages]);
  useRealtime(`finance:${kind}:${requestId}`, (m) => {
    if (m.type === 'chat.message' || m.type === 'chat.read') void load();
  });

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const message = text.trim();
    if (!message) return;
    setSending(true);
    setError(null);
    try {
      const sent = await post<ChatMessageDto>(base, { message });
      setMessages((m) => [...(m ?? []), sent]);
      setText('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Message not sent."));
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="flex flex-col">
      <CardHeader title={t("Conversation")} subtitle={side === 'PLAYER' ? t("Private chat with the support team about this request") : t("Private chat with the player")} icon={<MessageSquare className="size-4" />} />
      <div className="max-h-[420px] min-h-48 flex-1 space-y-3 overflow-y-auto px-5 py-4" aria-live="polite">
        {messages === null && !error && (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        )}
        {messages?.length === 0 && <EmptyState title={t("No messages yet")} description={t("Questions about this request? Send a message.")} />}
        {messages?.map((m) => (
          <div key={m.id} className={clsx('flex', m.isMine ? 'justify-end' : 'justify-start')}>
            <div
              className={clsx(
                'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm',
                m.isMine ? 'rounded-br-md bg-brand-600 text-white' : m.senderType === 'SYSTEM' ? 'bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-100' : 'rounded-bl-md bg-ink-100 dark:bg-ink-800',
              )}
            >
              {!m.isMine && <p className="mb-0.5 text-xs font-semibold opacity-80">{m.senderLabel}</p>}
              <p className="break-words whitespace-pre-wrap">{m.message}</p>
              <p className={clsx('mt-1 text-[11px]', m.isMine ? 'text-white/70' : 'text-ink-500')}>
                {dateTime(m.createdAt)}
                {m.isMine && m.readAt ? t(" · Read") : ''}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      {error && <p className="px-5 pb-2 text-sm text-rose-600" role="alert">{error}</p>}
      {canSend && (
        <form onSubmit={send} className="flex gap-2 border-t border-ink-100 p-3 dark:border-ink-800">
          <label htmlFor={`chat-${requestId}`} className="sr-only">
            {t("Message")}
          </label>
          <input id={`chat-${requestId}`} className="input" placeholder="Write a message… (never share PINs or OTPs)" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
          <Button type="submit" loading={sending} icon={<Send className="size-4" />} aria-label={t("Send message")}>
            <span className="hidden sm:inline">{t("Send")}</span>
          </Button>
        </form>
      )}
    </Card>
  );
}
