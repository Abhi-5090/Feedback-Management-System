import AppShell from './AppShell.jsx';

// `icon` is a name from the Icon registry (components/Icon.jsx) — never an emoji.
const nav = [
  { to: '/trainer', label: 'My Dashboard', icon: 'dashboard', end: true },
  { to: '/trainer/feedbacks', label: 'Feedbacks', icon: 'message' },
  { to: '/trainer/batches', label: 'My batches', icon: 'ticket' },
  { to: '/trainer/guide', label: 'How it works', icon: 'compass' },
  { to: '/trainer/settings', label: 'Settings', icon: 'sliders' },
];

export default function TrainerLayout() {
  return <AppShell brand="Feedback" roleLabel="Trainer" nav={nav} />;
}
