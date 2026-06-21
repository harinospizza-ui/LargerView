import React, { useEffect, useState } from 'react';
import { getNotificationDashboardData, NotificationDashboardData, NotificationStats } from '../services/orderApi';

export const AdminNotifications: React.FC = () => {
  const [dashboardData, setDashboardData] = useState<NotificationDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchStats = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await getNotificationDashboardData();
      setDashboardData(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch notification stats.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayStats: NotificationStats = dashboardData?.stats?.find(d => d.date === todayStr) || {
    date: todayStr,
    sent: 0,
    failed: 0,
    removedTokens: 0,
    updatedAt: ''
  };

  const totalDevices = dashboardData?.totalDevices || 0;
  const sentToday = todayStats.sent || 0;
  const failedToday = todayStats.failed || 0;
  const removedToday = todayStats.removedTokens || 0;

  // Firebase Quota Estimation Calculations
  // Every FCM dispatch writes 1 log transaction to notification_stats & reads token documents
  const estimatedReads = sentToday + failedToday + totalDevices; 
  const estimatedWrites = (sentToday > 0 || failedToday > 0) ? 1 : 0;
  const estimatedDeletes = removedToday;

  // Monthly projections based on historical logs
  const statsList = dashboardData?.stats || [];
  const avgSent = statsList.length ? statsList.reduce((acc, s) => acc + (s.sent || 0), 0) / statsList.length : sentToday;
  const avgFailed = statsList.length ? statsList.reduce((acc, s) => acc + (s.failed || 0), 0) / statsList.length : failedToday;
  const avgRemoved = statsList.length ? statsList.reduce((acc, s) => acc + (s.removedTokens || 0), 0) / statsList.length : removedToday;

  const projectedReads = (avgSent + avgFailed + totalDevices) * 30;
  const projectedWrites = 30; // 1 log increment per day
  const projectedDeletes = avgRemoved * 30;

  // Cost estimates: Reads $0.06/100k, Writes $0.18/100k, Deletes $0.02/100k
  const readsCost = (projectedReads * 0.06) / 100000;
  const writesCost = (projectedWrites * 0.18) / 100000;
  const deletesCost = (projectedDeletes * 0.02) / 100000;
  const totalCost = readsCost + writesCost + deletesCost;

  return (
    <div className="mx-auto max-w-6xl px-4 mt-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="font-display text-3xl font-extrabold text-glow text-white">FCM Delivery Center</h2>
          <p className="text-slate-400 text-xs font-medium mt-1">Real-time push delivery metrics, unregistered token pruning logs, and estimated database quota impact.</p>
        </div>
        <button
          onClick={fetchStats}
          className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 px-5 py-3.5 text-xs font-black uppercase tracking-widest text-slate-200 transition-premium"
        >
          🔄 Refresh Metrics
        </button>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center text-slate-400 font-bold">Loading dashboard data...</div>
      ) : error ? (
        <div className="rounded-3xl border border-red-500/20 bg-red-950/20 p-6 text-center text-red-300 font-bold mb-6">{error}</div>
      ) : (
        <div className="space-y-6">
          {/* Key Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Registered Devices */}
            <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/65 p-6 shadow-xl backdrop-blur-xl">
              <div className="absolute top-0 left-0 h-1.5 w-full bg-blue-500" />
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Registered Devices</div>
              <div className="mt-2 text-4xl font-extrabold text-white">{totalDevices}</div>
              <p className="text-[9px] text-slate-400 font-bold mt-2">Active push token channels</p>
            </div>

            {/* Sent Today */}
            <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/65 p-6 shadow-xl backdrop-blur-xl">
              <div className="absolute top-0 left-0 h-1.5 w-full bg-emerald-500" />
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Delivered Today</div>
              <div className="mt-2 text-4xl font-extrabold text-white">{sentToday}</div>
              <p className="text-[9px] text-slate-400 font-bold mt-2">Successful FCM dispatches</p>
            </div>

            {/* Failed Today */}
            <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/65 p-6 shadow-xl backdrop-blur-xl">
              <div className="absolute top-0 left-0 h-1.5 w-full bg-amber-500" />
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Dispatch Failures</div>
              <div className="mt-2 text-4xl font-extrabold text-white">{failedToday}</div>
              <p className="text-[9px] text-slate-400 font-bold mt-2">Unsent payload attempts</p>
            </div>

            {/* Tokens Pruned */}
            <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/65 p-6 shadow-xl backdrop-blur-xl">
              <div className="absolute top-0 left-0 h-1.5 w-full bg-red-500" />
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Tokens Pruned</div>
              <div className="mt-2 text-4xl font-extrabold text-white">{removedToday}</div>
              <p className="text-[9px] text-slate-400 font-bold mt-2">Expired/unregistered deleted</p>
            </div>
          </div>

          {/* Quota & Cost Impact */}
          <div className="rounded-[2.25rem] border border-white/10 bg-slate-950/85 p-6 shadow-2xl backdrop-blur-2xl">
            <h3 className="font-display text-xl font-bold mb-4 text-white">Estimated Firestore Quota Impact (FCM Pipeline)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-6">
              <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">Est. Today's Reads</div>
                <div className="mt-1 text-xl font-bold text-white">{estimatedReads}</div>
                <div className="mt-2 text-[10px] text-slate-400">Tokens + stats queries</div>
              </div>
              <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">Est. Today's Writes</div>
                <div className="mt-1 text-xl font-bold text-white">{estimatedWrites}</div>
                <div className="mt-2 text-[10px] text-slate-400">Stats logs increment</div>
              </div>
              <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">Est. Today's Deletes</div>
                <div className="mt-1 text-xl font-bold text-white">{estimatedDeletes}</div>
                <div className="mt-2 text-[10px] text-slate-400">Pruned bad registration docs</div>
              </div>
              <div className="p-4 rounded-2xl bg-blue-950/20 border border-blue-500/20">
                <div className="text-[9px] font-black uppercase tracking-widest text-blue-400">Est. Blended monthly cost</div>
                <div className="mt-1 text-2xl font-black text-blue-400">${totalCost.toFixed(3)}</div>
                <div className="mt-2 text-[10px] text-slate-500">Free under Spark daily limit</div>
              </div>
            </div>
          </div>

          {/* Historical Logs List */}
          <div className="rounded-[2.25rem] border border-white/10 bg-slate-950/85 p-6 shadow-xl backdrop-blur-xl">
            <h3 className="font-display text-lg font-bold mb-4 text-white">FCM Delivery Log History</h3>
            <div className="max-h-64 overflow-y-auto pr-1 space-y-3">
              {statsList.map((doc, idx) => (
                <div key={idx} className="flex justify-between items-center p-3 rounded-xl bg-white/[0.02] border border-white/5 text-xs">
                  <span className="text-slate-400 font-bold">{doc.date}</span>
                  <span className="text-slate-200">
                    Delivered: <b className="text-emerald-400">{doc.sent}</b> | Failures: <b className="text-amber-400">{doc.failed}</b> | Pruned: <b className="text-red-400">{doc.removedTokens || 0}</b>
                  </span>
                </div>
              ))}
              {statsList.length === 0 && (
                <div className="text-slate-500 text-xs text-center py-8">No historical delivery logs yet.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
