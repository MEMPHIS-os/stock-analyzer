import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Briefcase,
  SlidersHorizontal,
  Grid3x3,
  Menu,
} from 'lucide-react';
import { useApp } from '../context';

interface NavItem {
  path: string;
  label: string;
  icon: typeof LayoutDashboard;
  action?: () => void;
}

export default function MobileNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { setSidebarOpen, sidebarOpen } = useApp();

  const navItems: NavItem[] = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/portfolio', label: 'Portfolio', icon: Briefcase },
    { path: '/screener', label: 'Screener', icon: SlidersHorizontal },
    { path: '/heatmap', label: 'Heatmap', icon: Grid3x3 },
    {
      path: '__sidebar__',
      label: 'More',
      icon: Menu,
      action: () => setSidebarOpen(!sidebarOpen),
    },
  ];

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 h-14 flex items-center justify-around z-50"
      style={{
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderTop: '1px solid var(--glass-border)',
      }}
    >
      {/* Subtle gradient line at top */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent/20 to-transparent" />

      {navItems.map((item) => {
        const isActive = item.path !== '__sidebar__' && location.pathname === item.path;
        const Icon = item.icon;

        return (
          <button
            key={item.path}
            onClick={() => {
              if (item.action) {
                item.action();
              } else {
                navigate(item.path);
              }
            }}
            className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-all duration-200 relative ${
              isActive
                ? 'text-accent'
                : 'text-txt-secondary hover:text-txt-primary'
            }`}
          >
            {isActive && (
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-accent shadow-glow-sm" />
            )}
            <Icon className={`w-5 h-5 transition-transform duration-200 ${isActive ? 'scale-110' : ''}`} />
            <span className={`text-[10px] font-medium ${isActive ? 'font-semibold' : ''}`}>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
