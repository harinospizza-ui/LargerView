import React, { useEffect, useState } from 'react';
import { getFirestoreUsage } from '../services/orderApi';

interface UsageDoc {
  date: string;
  reads?: number;
  writes?: number;
  deletes?: number;
  ordersReads?: number;
  customersReads?: number;
  walletReads?: number;
  menuReads?: number;
  otherReads?: number;
  timestamp?: string;
}

export const AdminUsage: React.FC = () => {
  const [usageData, setUsageData] = useState<UsageDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchUsage = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await getFirestoreUsage();
      setUsageData(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch usage stats.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsage();
  }, []);

  // Today's stats
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayStats = usageData.find(d => d.date === todayStr) || {
    date: todayStr,
    reads: 0,
    writes: 0,
    deletes: 0,
    ordersReads: 0,
    customersReads: 0,
    walletReads: 0,
    menuReads: 0,
    otherReads: 0
  };

  // Spark Plan Limits
  const READ_LIMIT = 50000;
  const WRITE_LIMIT = 20000;
  const DELETE_LIMIT = 20000;

  const currentReads = todayStats.reads || 0;
  const currentWrites = todayStats.writes || 0;
  const currentDeletes = todayStats.deletes || 0;

  const readPercent = (currentReads / READ_LIMIT) * 100;
  const writePercent = (currentWrites / WRITE_LIMIT) * 100;
  const deletePercent = (currentDeletes / DELETE_LIMIT) * 100;

  // Monthly Estimations based on last 7 days average or today's projections
  const daysWithData = usageData.slice(0, 7);
  const avgReads = daysWithData.length ? daysWithData.reduce((acc, d) => acc + (d.reads || 0), 0) / daysWithData.length : currentReads;
  const avgWrites = daysWithData.length ? daysWithData.reduce((acc, d) => acc + (d.writes || 0), 0) / daysWithData.length : currentWrites;
  const avgDeletes = daysWithData.length ? daysWithData.reduce((acc, d) => acc + (d.deletes || 0), 0) / daysWithData.length : currentDeletes;

  // Pricing: $0.06 / 100,000 reads, $0.18 / 100,000 writes, $0.02 / 100,000 deletes
  const estReadsCost = (avgReads * 30 * 0.06) / 100000;
  const estWritesCost = (avgWrites * 30 * 0.18) / 100000;
  const estDeletesCost = (avgDeletes * 30 * 0.02) / 100000;
  const totalMonthlyCost = estReadsCost + estWritesCost + estDeletesCost;

  // Suspected Loop Alert: If reads for a single day exceed 15,000, trigger warning
  const isLoopSuspected = currentReads > 15000;

  return (
    <div className="mx-auto max-w-6xl px-4 mt-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="font-display text-3xl font-extrabold text-white">Firestore Quota Guard</h2>
          <p className="text-slate-400 text-xs font-medium mt-1">Real-time database operations log and estimated monthly costs.</p>
        </div>
        <button
          onClick={fetchUsage}
          className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 px-5 py-3.5 text-xs font-black uppercase tracking-widest text-slate-200 transition-premium"
        >
          🔄 Refresh Log
        </button>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center text-slate-400 font-bold">Loading usage stats...</div>
      ) : error ? (
        <div className="rounded-3xl border border-red-500/20 bg-red-950/20 p-6 text-center text-red-300 font-bold mb-6">{error}</div>
      ) : (
        <div className="space-y-6">
          {/* loop warning alert */}
          {isLoopSuspected && (
            <div className="flex items-center gap-4 rounded-3xl border border-red-500/30 bg-red-950/40 p-6 text-red-200 animate-pulse">
              <span className="text-3xl">⚠️</span>
              <div>
                <h4 className="font-bold text-base">Suspected Infinite Loop Alert</h4>
                <p className="text-xs mt-1 text-red-300 leading-5">Today's Firestore reads have scaled to {currentReads.toLocaleString()}. This is abnormally high and could indicate an active client-side subscription loop or poll error. Please verify client listeners immediately.</p>
              </div>
            </div>
          )}

          {/* quota warning banners */}
          {readPercent >= 70 && (
            <div className={`flex items-center gap-4 rounded-3xl border p-6 ${
              readPercent >= 95 
                ? 'border-red-600/30 bg-red-950/30 text-red-300' 
                : readPercent >= 85 
                  ? 'border-orange-500/30 bg-orange-950/30 text-orange-300' 
                  : 'border-yellow-500/30 bg-yellow-950/30 text-yellow-300'
            }`}>
              <span className="text-3xl">🚨</span>
              <div>
                <h4 className="font-bold text-base">
                  {readPercent >= 95 ? 'Critical Limit: Spark Plan Quota Exhaustion Near' : readPercent >= 85 ? 'Warning: High Quota Consumption' : 'Notice: Quota Alert'}
                </h4>
                <p className="text-xs mt-1 leading-5">
                  Firestore daily reads have reached {readPercent.toFixed(1)}% of the daily Spark limit. The server will reject database reads once it hits 50,000 operations, causing a service outage.
                </p>
              </div>
            </div>
          )}

          {/* Top level stats cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/65 p-6 shadow-xl backdrop-blur-xl">
              <div className="absolute top-0 left-0 h-1.5 w-full bg-blue-500" />
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Daily Reads (Spark limit 50k)</div>
              <div className="mt-2 text-4xl font-extrabold text-white">{currentReads.toLocaleString()}</div>
              <div className="mt-4 flex items-center justify-between text-xs">
                <span className="text-slate-400 font-bold">Quota Used</span>
                <span className="font-extrabold text-blue-400">{readPercent.toFixed(1)}%</span>
              </div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${Math.min(readPercent, 100)}%` }} />
              </div>
            </div>

            <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/65 p-6 shadow-xl backdrop-blur-xl">
              <div className="absolute top-0 left-0 h-1.5 w-full bg-emerald-500" />
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Daily Writes (Spark limit 20k)</div>
              <div className="mt-2 text-4xl font-extrabold text-white">{currentWrites.toLocaleString()}</div>
              <div className="mt-4 flex items-center justify-between text-xs">
                <span className="text-slate-400 font-bold">Quota Used</span>
                <span className="font-extrabold text-emerald-400">{writePercent.toFixed(1)}%</span>
              </div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${Math.min(writePercent, 100)}%` }} />
              </div>
            </div>

            <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/65 p-6 shadow-xl backdrop-blur-xl">
              <div className="absolute top-0 left-0 h-1.5 w-full bg-red-500" />
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Daily Deletes (Spark limit 20k)</div>
              <div className="mt-2 text-4xl font-extrabold text-white">{currentDeletes.toLocaleString()}</div>
              <div className="mt-4 flex items-center justify-between text-xs">
                <span className="text-slate-400 font-bold">Quota Used</span>
                <span className="font-extrabold text-red-400">{deletePercent.toFixed(1)}%</span>
              </div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                <div className="h-full bg-red-500 transition-all duration-500" style={{ width: `${Math.min(deletePercent, 100)}%` }} />
              </div>
            </div>
          </div>

          {/* Pricing Estimation card */}
          <div className="rounded-[2.25rem] border border-white/10 bg-slate-950/85 p-6 shadow-2xl backdrop-blur-2xl">
            <h3 className="font-display text-xl font-bold mb-4 text-white">Estimated Monthly Pricing</h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-6">
              <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">Avg Daily Reads</div>
                <div className="mt-1 text-xl font-bold text-white">{Math.round(avgReads).toLocaleString()}</div>
                <div className="mt-2 text-xs text-slate-400">Est. Cost: ${estReadsCost.toFixed(2)}</div>
              </div>
              <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">Avg Daily Writes</div>
                <div className="mt-1 text-xl font-bold text-white">{Math.round(avgWrites).toLocaleString()}</div>
                <div className="mt-2 text-xs text-slate-400">Est. Cost: ${estWritesCost.toFixed(2)}</div>
              </div>
              <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">Avg Daily Deletes</div>
                <div className="mt-1 text-xl font-bold text-white">{Math.round(avgDeletes).toLocaleString()}</div>
                <div className="mt-2 text-xs text-slate-400">Est. Cost: ${estDeletesCost.toFixed(2)}</div>
              </div>
              <div className="p-4 rounded-2xl bg-red-950/20 border border-red-500/20">
                <div className="text-[9px] font-black uppercase tracking-widest text-red-400">Total Proj. Monthly Cost</div>
                <div className="mt-1 text-2xl font-black text-red-500">${totalMonthlyCost.toFixed(2)}</div>
                <div className="mt-2 text-[10px] text-slate-500">Blended Spark rate</div>
              </div>
            </div>
          </div>

          {/* Collection breakdown table & history log */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Reads Breakdown */}
            <div className="rounded-[2.25rem] border border-white/10 bg-slate-950/85 p-6 shadow-xl backdrop-blur-xl">
              <h3 className="font-display text-lg font-bold mb-4 text-white">Today's Reads Breakdown</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                  <span className="text-slate-400 text-xs font-bold">Orders Collection</span>
                  <span className="text-white text-xs font-extrabold">{ (todayStats.ordersReads || 0).toLocaleString() } reads</span>
                </div>
                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                  <span className="text-slate-400 text-xs font-bold">Customers Collection</span>
                  <span className="text-white text-xs font-extrabold">{ (todayStats.customersReads || 0).toLocaleString() } reads</span>
                </div>
                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                  <span className="text-slate-400 text-xs font-bold">Wallets & Transactions</span>
                  <span className="text-white text-xs font-extrabold">{ (todayStats.walletReads || 0).toLocaleString() } reads</span>
                </div>
                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                  <span className="text-slate-400 text-xs font-bold">Menu & Settings</span>
                  <span className="text-white text-xs font-extrabold">{ (todayStats.menuReads || 0).toLocaleString() } reads</span>
                </div>
                <div className="flex justify-between items-center pb-2">
                  <span className="text-slate-400 text-xs font-bold">Other Queries</span>
                  <span className="text-white text-xs font-extrabold">{ (todayStats.otherReads || 0).toLocaleString() } reads</span>
                </div>
              </div>
            </div>

            {/* Historical usage logs */}
            <div className="rounded-[2.25rem] border border-white/10 bg-slate-950/85 p-6 shadow-xl backdrop-blur-xl">
              <h3 className="font-display text-lg font-bold mb-4 text-white">Historical Usage Log</h3>
              <div className="max-h-64 overflow-y-auto pr-1 space-y-3">
                {usageData.map((doc, idx) => (
                  <div key={idx} className="flex justify-between items-center p-3 rounded-xl bg-white/[0.02] border border-white/5 text-xs">
                    <span className="text-slate-450 text-slate-400 font-bold">{doc.date}</span>
                    <span className="text-slate-200">
                      R: <b>{ (doc.reads || 0).toLocaleString() }</b> | W: <b>{ (doc.writes || 0).toLocaleString() }</b> | D: <b>{ (doc.deletes || 0).toLocaleString() }</b>
                    </span>
                  </div>
                ))}
                {usageData.length === 0 && (
                  <div className="text-slate-500 text-xs text-center py-8">No usage logs available.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
