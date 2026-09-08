import AppShell from './AppShell.jsx';

// `icon` is a name from the Icon registry (components/Icon.jsx) — never an emoji.
const nav = [
  { to: '/admin', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/admin/feedbacks', label: 'Feedbacks', icon: 'message' },
  { to: '/admin/trainers', label: 'Mentors', icon: 'users' },
  { to: '/admin/compare', label: 'Compare', icon: 'barChart' },
  { to: '/admin/cohorts', label: 'Cohorts', icon: 'graduation' },
  { to: '/admin/classes', label: 'Classes', icon: 'book' },
  { to: '/admin/parameters', label: 'Parameters', icon: 'sliders' },
  { to: '/admin/batches', label: 'Batches', icon: 'ticket' },
  { to: '/admin/audit', label: 'Audit trail', icon: 'shield' },
  { to: '/admin/guide', label: 'How it works', icon: 'compass' },
  { to: '/admin/settings', label: 'Settings', icon: 'sliders' },
];

export default function AdminLayout() {
  return <AppShell brand="Feedback" roleLabel="Admin" nav={nav} />;
}
