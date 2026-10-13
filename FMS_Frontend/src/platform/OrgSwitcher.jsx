import { useLocation, useNavigate } from 'react-router-dom';
import { useOrgScope } from './OrgScope.jsx';
import Icon from '../components/Icon.jsx';

/**
 * The organization a super admin is acting on.
 *
 * Deliberately prominent and always visible rather than tucked into a menu.
 * Every figure on every page below it means something different depending on
 * this control, and a destructive action taken in the wrong tenant is not
 * recoverable by the person who took it. A selector that can be forgotten is
 * the wrong shape for something that reframes the entire screen.
 */
export default function OrgSwitcher() {
  const { isSuper, organizations, orgId, setOrg, loaded } = useOrgScope();
  const navigate = useNavigate();
  const location = useLocation();
  if (!isSuper) return null;

  /* Picking an organization from the platform screens moves into that tenant's
     admin area; clearing it comes back out. Without this, clearing the
     selection leaves them on an admin page belonging to no organization, which
     the server correctly refuses to answer. */
  const choose = (next) => {
    setOrg(next);
    if (next && location.pathname.startsWith('/platform')) navigate('/admin');
    else if (!next && location.pathname.startsWith('/admin')) navigate('/platform');
  };

  return (
    <label className="flex min-w-0 items-center gap-2">
      <span className="sr-only">Organization</span>
      <span
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${
          orgId ? 'bg-brand-500/12 text-brand-600 dark:text-brand-400' : 'bg-surface-2 text-muted'
        }`}
        aria-hidden="true"
      >
        <Icon name="building" size={15} />
      </span>
      <select
        value={orgId}
        onChange={(e) => choose(e.target.value)}
        disabled={!loaded}
        className="select max-w-[220px] truncate !py-1.5 text-sm"
        aria-label="Organization"
      >
        {/* The platform view is the first option because it is the super
            admin's home: everything, before narrowing to one tenant. */}
        <option value="">All organizations</option>
        {organizations.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
            {o.status === 'suspended' ? ' — suspended' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
