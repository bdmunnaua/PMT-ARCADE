import { Link } from 'react-router';

export function Logo({ name = 'PMT Arcade', compact, to = '/' }: { name?: string; compact?: boolean; to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2.5 font-bold tracking-tight">
      <img src="/favicon.svg" alt="" className="size-8" />
      <span className={compact ? 'text-base' : 'text-lg'}>{name}</span>
    </Link>
  );
}
