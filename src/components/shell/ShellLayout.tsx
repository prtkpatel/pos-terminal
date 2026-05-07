import React from 'react';
import { Outlet } from 'react-router-dom';
import { 
  Wifi, 
  WifiOff, 
  RefreshCw, 
  User, 
  Monitor,
  Package
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useSyncStore } from '../../stores/syncStore';

export function ShellLayout() {
  const { isOnline, outboxCount } = useSyncStore();

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-slate-50 text-slate-900 font-sans select-none">
      {/* Top Status Bar */}
      <header className="flex h-10 items-center justify-between border-b bg-white px-6 shadow-sm">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-blue-600 flex items-center justify-center">
              <Package size={14} className="text-white" />
            </div>
            <span className="font-bold text-slate-800">Atulyam Pos</span>
          </div>
          <div className="h-4 w-[1px] bg-slate-200" />
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <Monitor size={14} />
            <span>Terminal: POS-01</span>
          </div>
        </div>

        <div className="flex items-center gap-6 text-[11px] font-bold uppercase tracking-wider text-slate-500">
          <div className={cn(
            "flex items-center gap-1.5",
            isOnline ? "text-emerald-600" : "text-rose-600"
          )}>
            {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
            <span>{isOnline ? 'Online' : 'Offline'}</span>
          </div>
          <div className="flex items-center gap-2 border-l pl-6">
            <User size={14} />
            <span>Admin Mode</span>
          </div>
        </div>
      </header>

      {/* Main Viewport */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>

      {/* Footer System Info */}
      <footer className="flex h-6 items-center justify-between border-t bg-slate-100 px-6 text-[10px] font-medium text-slate-400">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <RefreshCw size={12} className={cn(outboxCount > 0 && "animate-spin")} />
            <span>Outbox: {outboxCount} pending sync</span>
          </div>
        </div>
        <span>Super-Store Platform v1.0.0</span>
      </footer>
    </div>
  );
}
