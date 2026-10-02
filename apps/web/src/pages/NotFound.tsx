import { Compass } from 'lucide-react';
import { ButtonLink, EmptyState } from '../components/ui';
import { t } from '../lib/i18n';

export function NotFoundPage() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <EmptyState icon={<Compass className="size-6" />} title={t("Page not found")} description={t("The page you are looking for does not exist or you do not have access to it.")} action={<ButtonLink to="/">{t("Go to dashboard")}</ButtonLink>} />
    </div>
  );
}
