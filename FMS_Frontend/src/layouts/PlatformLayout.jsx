import AppShell from './AppShell.jsx';

/**
 * The super admin's own area: the tenants, not any one tenant's data.
 *
 * Kept deliberately small. Everything about running an institution — mentors,
 * cohorts, feedback — happens in the admin screens, which a super admin enters
 * by choosing an organization. Rebuilding those here would give the product
 * two copies of every page to keep in step, and they would not stay in step.
 */
const nav = [
  { to: '/platform', label: 'Organizations', icon: 'building', end: true },
  { to: '/platform/settings', label: 'Settings', icon: 'sliders' },
];

export default function PlatformLayout() {
  return <AppShell brand="Torii Platform" roleLabel="Super admin" nav={nav} />;
}
