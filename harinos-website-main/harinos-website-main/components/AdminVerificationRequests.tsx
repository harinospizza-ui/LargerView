import React, { useEffect, useState } from 'react';
import { VerificationRequest, AdminSession } from '../types';
import { subscribeServerVerificationRequests } from '../services/orderApi';

interface AdminVerificationRequestsProps {
  session: AdminSession;
}

export const AdminVerificationRequests: React.FC<AdminVerificationRequestsProps> = ({ session }) => {
  const [requests, setRequests] = useState<VerificationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    setLoading(true);
    const unsubscribe = subscribeServerVerificationRequests(
      (data) => {
        setRequests(data);
        setLoading(false);
      },
      (err) => {
        setError(err.message || 'Failed to fetch verification requests.');
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const handleSendWhatsApp = (req: VerificationRequest) => {
    let phone = req.mobileNumber.replace(/\D/g, '');
    if (phone.length === 10) {
      phone = '91' + phone;
    }
    const message = `Hello ${req.customerName},\n\nYour Harino's verification code is:\n\n${req.otp}\n\nThank you,\nHarino's Pizza`;
    const encoded = encodeURIComponent(message);
    window.open(`https://wa.me/${phone}?text=${encoded}`, '_blank');
  };

  const filteredRequests = requests.filter(req => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return true;
    return (
      req.customerName.toLowerCase().includes(query) ||
      req.mobileNumber.includes(query) ||
      req.otp.includes(query) ||
      req.status.toLowerCase().includes(query)
    );
  });

  return (
    <div className="mx-auto max-w-6xl px-4 mt-6 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="font-display text-3xl font-extrabold text-glow text-white">Customer Verification Requests</h2>
          <p className="text-slate-400 text-xs font-medium mt-1">
            Manage verification requests. Click "Send OTP via WhatsApp" to share verification codes manually.
          </p>
        </div>
      </div>

      <div className="mb-6 flex gap-3">
        <input
          type="text"
          placeholder="Search by name, phone, OTP, or status..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 font-bold text-white placeholder-slate-500 outline-none focus:border-red-500 transition-all text-sm"
        />
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center text-slate-400 font-bold">
          Loading verification requests...
        </div>
      ) : error ? (
        <div className="rounded-3xl border border-red-500/20 bg-red-950/20 p-6 text-center text-red-300 font-bold mb-6">
          {error}
        </div>
      ) : filteredRequests.length === 0 ? (
        <div className="rounded-[2.25rem] border border-white/10 bg-slate-950/65 p-12 text-center text-slate-400 font-bold backdrop-blur-xl">
          No verification requests found.
        </div>
      ) : (
        <div className="overflow-hidden rounded-[2.25rem] border border-white/10 bg-slate-950/65 shadow-2xl backdrop-blur-xl">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm text-slate-200">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.02] text-xs font-black uppercase tracking-widest text-slate-400">
                  <th className="px-6 py-4">Customer Name</th>
                  <th className="px-6 py-4">Mobile Number</th>
                  <th className="px-6 py-4">OTP Code</th>
                  <th className="px-6 py-4">Request Time</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-medium">
                {filteredRequests.map((req) => (
                  <tr key={req.requestId} className="hover:bg-white/[0.01] transition-colors">
                    <td className="px-6 py-4 font-bold text-white">{req.customerName}</td>
                    <td className="px-6 py-4 text-slate-300">{req.mobileNumber}</td>
                    <td className="px-6 py-4">
                      <span className="rounded-xl bg-red-500/10 px-3 py-1.5 font-mono text-xs font-black text-red-400 border border-red-500/20">
                        {req.otp}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-400">
                      {new Date(req.createdAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${
                          req.status === 'verified'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        }`}
                      >
                        {req.status === 'verified' ? '✓ Verified' : '● Pending'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {req.status === 'pending' && (
                        <button
                          onClick={() => handleSendWhatsApp(req)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-[#25D366] hover:bg-[#20ba56] px-3.5 py-2 text-xs font-black uppercase tracking-widest text-slate-950 transition-premium active:scale-95 cursor-pointer shadow-lg shadow-[#25D366]/10"
                        >
                          💬 Send OTP via WhatsApp
                        </button>
                      )}
                      {req.status === 'verified' && (
                        <span className="text-xs text-slate-500 font-bold">
                          Verified by {req.verifiedBy || 'customer'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
