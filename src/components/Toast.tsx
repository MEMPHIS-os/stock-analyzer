import { CheckCircle, XCircle, Info, AlertTriangle, X } from 'lucide-react';
import { useApp } from '../context';
import type { ToastType } from '../context';

const iconMap: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
};

const colorMap: Record<ToastType, { icon: string; border: string; bg: string; glow: string }> = {
  success: {
    icon: 'text-success',
    border: 'border-l-success',
    bg: 'bg-success/10',
    glow: '0 0 20px -5px rgba(38, 166, 154, 0.3)',
  },
  error: {
    icon: 'text-danger',
    border: 'border-l-danger',
    bg: 'bg-danger/10',
    glow: '0 0 20px -5px rgba(239, 83, 80, 0.3)',
  },
  warning: {
    icon: 'text-warning',
    border: 'border-l-warning',
    bg: 'bg-warning/10',
    glow: '0 0 20px -5px rgba(255, 152, 0, 0.3)',
  },
  info: {
    icon: 'text-accent',
    border: 'border-l-accent',
    bg: 'bg-accent/10',
    glow: '0 0 20px -5px rgba(41, 98, 255, 0.3)',
  },
};

export default function ToastContainer() {
  const { toasts, dismissToast } = useApp();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2.5 max-w-sm">
      {toasts.map((toast) => {
        const Icon = iconMap[toast.type];
        const colors = colorMap[toast.type];

        return (
          <div
            key={toast.id}
            className={`flex items-start gap-3 px-4 py-3.5 rounded-xl border-l-4 animate-toast-in ${colors.border}`}
            style={{
              background: 'var(--glass-bg)',
              backdropFilter: 'blur(20px) saturate(180%)',
              WebkitBackdropFilter: 'blur(20px) saturate(180%)',
              border: '1px solid var(--glass-border)',
              borderLeft: `4px solid`,
              boxShadow: `${colors.glow}, 0 8px 32px -8px rgba(0,0,0,0.3)`,
            }}
            role="alert"
          >
            <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${colors.icon}`} />
            <p className="text-sm text-txt-primary flex-1 font-medium">{toast.message}</p>
            <button
              onClick={() => dismissToast(toast.id)}
              className="shrink-0 p-1 hover:bg-dark-600/50 rounded-lg transition-all duration-200"
              aria-label="Close"
            >
              <X className="w-4 h-4 text-txt-secondary" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
