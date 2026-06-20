import React, { useEffect, useState } from 'react';
import { getBackupStatus, triggerDatabaseBackup, triggerDatabaseRestore, BackupDetail } from '../services/orderApi';
import { AdminSession } from '../types';

interface AdminBackupProps {
  session: AdminSession | null;
}

export const AdminBackup: React.FC<AdminBackupProps> = ({ session }) => {
  const [backups, setBackups] = useState<BackupDetail[]>([]);
  const [lastBackupTime, setLastBackupTime] = useState('Never');
  const [lastBackupSize, setLastBackupSize] = useState('0 KB');
  const [lastBackupStatus, setLastBackupStatus] = useState('N/A');
  const [lastBackupLocation, setLastBackupLocation] = useState('N/A');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [restoreConfirmFile, setRestoreConfirmFile] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await getBackupStatus();
      if (data.success) {
        setBackups(data.backups || []);
        setLastBackupTime(data.lastBackupTime || 'Never');
        setLastBackupSize(data.lastBackupSize || '0 KB');
        setLastBackupStatus(data.lastBackupStatus || 'N/A');
        setLastBackupLocation(data.lastBackupLocation || 'N/A');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch backup status.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchStatus();
  }, []);

  const handleCreateBackup = async () => {
    try {
      setLoading(true);
      setError('');
      setSuccessMessage('');
      const res = await triggerDatabaseBackup();
      if (res.success) {
        setSuccessMessage(`Backup completed successfully! Filename: ${res.backup.filename}`);
        await fetchStatus();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create backup.');
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (filename: string) => {
    try {
      setLoading(true);
      setError('');
      setSuccessMessage('');
      setRestoreConfirmFile(null);
      const res = await triggerDatabaseRestore(filename);
      if (res.success) {
        setSuccessMessage('Database restored successfully! A safety emergency rollback copy was created.');
        await fetchStatus();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to restore database.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 mt-6">
      <div className="rounded-[2.25rem] border border-white/10 bg-slate-950/85 p-6 shadow-2xl backdrop-blur-2xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <h2 className="font-display text-3xl font-bold bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">SSD Database Backups</h2>
            <p className="text-xs text-slate-400 mt-1">Manage local MySQL exports on your External SSD & Laptop Storage.</p>
          </div>
          <button
            onClick={handleCreateBackup}
            disabled={loading}
            className="rounded-2xl bg-gradient-premium px-6 py-3.5 text-xs font-black uppercase tracking-widest text-white shadow-[0_15px_30px_rgba(220,38,38,0.25)] hover:scale-[1.02] active:scale-95 transition disabled:opacity-50"
          >
            {loading ? 'Processing...' : 'Create Full Backup'}
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-xs font-bold text-red-300">
            ⚠️ {error}
          </div>
        )}

        {successMessage && (
          <div className="mt-4 rounded-xl border border-green-500/20 bg-green-500/10 p-4 text-xs font-bold text-green-300">
            ✅ {successMessage}
          </div>
        )}

        {/* Database Stats Card */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Backup Status</div>
            <div className="mt-1.5 font-display text-lg font-bold text-green-400">{lastBackupStatus === 'verified' ? 'Healthy & Verified' : lastBackupStatus}</div>
          </div>
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Last Backup Time</div>
            <div className="mt-1.5 font-display text-sm font-bold truncate text-slate-200" title={lastBackupTime}>
              {lastBackupTime !== 'Never' ? new Date(lastBackupTime).toLocaleString() : 'Never'}
            </div>
          </div>
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Backup Size</div>
            <div className="mt-1.5 font-display text-lg font-bold text-slate-200">{lastBackupSize}</div>
          </div>
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Backup Paths</div>
            <div className="mt-1.5 text-[10px] font-mono leading-relaxed text-slate-400 truncate" title={lastBackupLocation}>
              SSD & C:\harinos-backups
            </div>
          </div>
        </div>

        {/* Backup History Table */}
        <div className="mt-8">
          <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-4">Backup History ({backups.length})</h3>
          {backups.length === 0 ? (
            <div className="rounded-2xl border border-white/5 bg-white/[0.01] py-12 text-center text-xs text-slate-500 font-bold">
              No backup exports found on SSD.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-white/5 bg-slate-950/40">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-white/5 bg-white/[0.02] text-slate-400 font-black uppercase tracking-widest">
                    <th className="p-4">Filename</th>
                    <th className="p-4">Created At</th>
                    <th className="p-4">Size</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {backups.map((bk) => (
                    <tr key={bk.filename} className="hover:bg-white/[0.01] transition-colors">
                      <td className="p-4 font-mono font-bold text-slate-300">{bk.filename}</td>
                      <td className="p-4 text-slate-400">{new Date(bk.createdAt).toLocaleString()}</td>
                      <td className="p-4 text-slate-300 font-semibold">{bk.size}</td>
                      <td className="p-4">
                        <span className="rounded-full bg-green-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-green-400">
                          {bk.status}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <button
                          onClick={() => setRestoreConfirmFile(bk.filename)}
                          disabled={loading}
                          className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-1.5 font-bold text-red-400 hover:bg-red-500 hover:text-white transition active:scale-95 disabled:opacity-50"
                        >
                          Restore
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Restore Confirmation Modal */}
      {restoreConfirmFile && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-950/80 p-4 animate-fade-in">
          <div className="w-full max-w-md rounded-[2.25rem] border border-white/10 bg-slate-950 p-6 shadow-[0_25px_60px_rgba(0,0,0,0.8)] backdrop-blur-2xl">
            <h3 className="text-xl font-display font-bold text-white">⚠️ Database Restoration</h3>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              Are you sure you want to overwrite your active database with the contents of <span className="font-mono text-red-300 font-bold">{restoreConfirmFile}</span>?
            </p>
            <div className="mt-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20 p-3.5 text-[11px] leading-relaxed text-yellow-300 font-semibold">
              🔒 **Safety First**: The system will automatically generate an emergency snapshot (`Backup_Emergency_*.sql`) of your current database on the SSD before performing this restore, allowing you to undo this action at any time.
            </div>
            <div className="flex gap-2 justify-end mt-6">
              <button
                onClick={() => setRestoreConfirmFile(null)}
                disabled={loading}
                className="rounded-xl bg-white/5 hover:bg-white/10 px-4 py-2.5 text-xs font-bold text-slate-300 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRestore(restoreConfirmFile)}
                disabled={loading}
                className="rounded-xl bg-gradient-premium px-5 py-2.5 text-xs font-black uppercase tracking-widest text-white shadow-[0_10px_20px_rgba(220,38,38,0.2)] hover:scale-102 active:scale-95 transition"
              >
                {loading ? 'Restoring...' : 'Confirm Restore'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
