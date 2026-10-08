import { useState, type FormEvent } from 'react';
import { BadgeCheck, LogOut, MailWarning, Trash2 } from 'lucide-react';
import type { MeDto } from '@arena/shared';
import { useAuth, useMe } from '../../auth/AuthProvider';
import { CopyText, ThemeToggle } from '../../components/Common';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, Input, KeyValue, PageHeader, StatusBadge, useToast } from '../../components/ui';
import { ApiError, patch, post } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { useDocumentTitle } from '../../lib/hooks';
import { t } from '../../lib/i18n';
import { MicCheck } from '../../games/shared/MicCheck';

export default function ProfilePage() {
  useDocumentTitle(t("Profile"));
  const me = useMe();
  const { refreshMe, signOut } = useAuth();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(me.displayName);
  const [avatarUrl, setAvatarUrl] = useState(me.avatarUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteSent, setDeleteSent] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await patch<MeDto>('/api/me', { displayName, avatarUrl });
      await refreshMe();
      toast.success(t("Profile saved."));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("Could not save."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-6">
      <PageHeader title={t("Profile")} actions={<Button variant="outline" icon={<LogOut className="size-4" />} onClick={() => void signOut()}>{t("Sign out")}</Button>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("Account")} actions={<StatusBadge status={me.accountStatus} />} />
          <CardBody>
            <KeyValue
              items={[
                ['Player number', <span className="text-lg font-bold">#{me.playerNumber}</span>],
                ['Username', `@${me.username}`],
                [
                  'Email (private)',
                  <span className="flex flex-wrap items-center gap-2">
                    {me.email}
                    {me.emailVerified ? (
                      <Badge tone="success">
                        <BadgeCheck className="size-3" /> {t("Verified")}
                      </Badge>
                    ) : (
                      <Badge tone="warning">
                        <MailWarning className="size-3" /> {t("Unverified")}
                      </Badge>
                    )}
                  </span>,
                ],
                ['Member since', dateTime(me.createdAt)],
                ['Last sign-in', dateTime(me.lastLoginAt)],
                ['Account ID', <CopyText value={me.id} label={t("Account ID")} />],
              ]}
            />
            <p className="mt-5 text-xs text-ink-500 dark:text-ink-400">{t("Email, password and verification are managed by your main account.")}</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t('Voice chat microphone')} subtitle={t('Check that your browser lets pmtarcade.com use the microphone, for talking in private rooms.')} />
          <CardBody>
            <MicCheck />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("Public profile")} subtitle={t("Your player number and username are permanent.")} />
          <CardBody>
            <form onSubmit={save} className="space-y-4">
              <Input label={t("Display name")} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} required />
              <Input label={t("Avatar image URL (https, optional)")} value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" />
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-ink-500">
                  {t("Theme")} <ThemeToggle />
                </span>
                <Button type="submit" loading={busy}>
                  {t("Save changes")}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      </div>

      {/* required by Google Play for apps with accounts; the request reaches the admin inbox */}
      <Card>
        <CardHeader title={t('Delete my account')} subtitle={t('Your account and personal data are deleted within 30 days. Use or withdraw your PMT first — any balance left ends with the account.')} />
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <a href="/delete-account/" className="text-sm text-brand-600 underline">
            {t('What is deleted and what is kept')}
          </a>
          <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)} disabled={deleteSent}>
            {deleteSent ? t('Deletion requested') : t('Delete my account')}
          </Button>
        </CardBody>
      </Card>
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={t('Delete your account?')}
        confirmLabel={t('Yes, delete my account')}
        tone="danger"
        message={t('We will delete your account #{n} and your personal data within 30 days and confirm by email. This cannot be undone.', { n: String(me.playerNumber) })}
        onConfirm={async () => {
          await post('/api/me/messages', {
            category: 'REQUEST',
            body: `ACCOUNT DELETION REQUEST — please delete account #${me.playerNumber} (@${me.username}) and its personal data, as described on pmtarcade.com/delete-account/.`,
          });
          setDeleteSent(true);
          toast.success(t('Deletion requested. We will confirm by email.'));
        }}
      />
    </div>
  );
}
