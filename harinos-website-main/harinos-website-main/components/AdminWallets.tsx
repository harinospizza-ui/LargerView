import React, { useState } from 'react';
import { CustomerProfile, WalletTransaction, AdminSession } from '../types';
import { StorageService } from '../services/storage';
import { 
  saveCustomerToServer, 
  saveWalletTransactionToServer, 
  getServerCustomers, 
  deleteCustomerFromServer,
  blockCustomerOnServer,
  sendOtpToCustomer,
  bulkRemoveCustomersFromServer,
  mergeCustomersOnServer
} from '../services/orderApi';

interface AdminWalletsProps {
  session: AdminSession;
  customers: CustomerProfile[];
  transactions: WalletTransaction[];
  onRefresh: () => void;
  onVerifyCustomer: (customer: CustomerProfile) => void;
}

export const AdminWallets: React.FC<AdminWalletsProps> = ({
  session,
  customers,
  transactions,
  onRefresh,
  onVerifyCustomer,
}) => {
  const [walletSearchQuery, setWalletSearchQuery] = useState('');
  const [editingCustomer, setEditingCustomer] = useState<CustomerProfile | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');

  // New States for Phase 4
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [otpStatuses, setOtpStatuses] = useState<Record<string, { success: boolean; message: string; timestamp: string }>>({});
  const [mergePrimaryId, setMergePrimaryId] = useState<Record<string, string>>({});

  const normalizePhoneForWhatsApp = (phone: string): string => {
    const digits = phone.replace(/\D/g, '');
    return digits.length === 10 ? `91${digits}` : digits;
  };

  const cleanPhoneStr = (p: string) => p.replace(/\D/g, '');

  // Group customers by cleaned phone number to find duplicate profiles
  const duplicatesGrouped = React.useMemo(() => {
    const groups: Record<string, CustomerProfile[]> = {};
    customers.forEach((c) => {
      const clean = cleanPhoneStr(c.phone);
      if (clean) {
        if (!groups[clean]) groups[clean] = [];
        groups[clean].push(c);
      }
    });
    const duplicates: Record<string, CustomerProfile[]> = {};
    Object.keys(groups).forEach((key) => {
      if (groups[key].length > 1) {
        duplicates[key] = groups[key];
      }
    });
    return duplicates;
  }, [customers]);

  const handleToggleSelect = (customerId: string) => {
    setSelectedCustomerIds((prev) =>
      prev.includes(customerId)
        ? prev.filter((id) => id !== customerId)
        : [...prev, customerId]
    );
  };

  const handleSelectAll = () => {
    if (selectedCustomerIds.length === filteredCustomers.length) {
      setSelectedCustomerIds([]);
    } else {
      setSelectedCustomerIds(filteredCustomers.map((c) => c.id));
    }
  };

  const handleBulkRemove = async () => {
    if (selectedCustomerIds.length === 0) return;
    if (confirm(`Are you sure you want to REMOVE the ${selectedCustomerIds.length} selected customers? This action is permanent.`)) {
      try {
        await bulkRemoveCustomersFromServer(selectedCustomerIds);
        alert(`Successfully removed ${selectedCustomerIds.length} customers.`);
        setSelectedCustomerIds([]);
        onRefresh();
      } catch (err: any) {
        alert(err.message || 'Failed to perform bulk remove.');
      }
    }
  };

  const filteredCustomers = customers.filter((cust) => {
    const query = walletSearchQuery.toLowerCase().trim();
    if (!query) return true;
    return cust.name.toLowerCase().includes(query) || cust.phone.includes(query);
  });

  const pendingTransactions = transactions.filter((tx) => {
    if (tx.status !== 'pending') return false;
    const query = walletSearchQuery.toLowerCase().trim();
    if (!query) return true;
    return tx.customerName.toLowerCase().includes(query) || tx.customerPhone.includes(query);
  });

  return (
    <section className="relative mx-auto max-w-6xl p-4 animate-fade-in">
      <h3 className="mb-4 font-display text-2xl font-bold font-black">Wallets & Customers Control</h3>

      {/* Search Bar */}
      <div className="mb-6">
        <label className="block text-[10px] font-black uppercase tracking-[0.25em] text-slate-500 mb-2">Search Customers</label>
        <input
          type="text"
          placeholder="Enter customer name or phone number..."
          value={walletSearchQuery}
          onChange={(e) => setWalletSearchQuery(e.target.value)}
          className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-white outline-none focus:border-red-500 font-bold transition focus:bg-white/10"
        />
      </div>

      {/* Customer Verification Section */}
      <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-5 mb-6">
        <div className="flex justify-between items-center mb-4">
          <h4 className="font-display font-bold text-lg text-red-300">Customer Management</h4>
          {session.role === 'admin' && (
            <button
              onClick={() => {
                setShowAddForm(true);
                setEditingCustomer(null);
                setNewName('');
                setNewPhone('');
                setNewEmail('');
              }}
              className="rounded-xl bg-red-650 hover:bg-red-655 text-white font-bold px-3 py-1.5 text-[10px] uppercase tracking-wider transition-premium active:scale-95"
            >
              ➕ Add Customer
            </button>
          )}
        </div>

        {/* Add Customer Form */}
        {showAddForm && (
          <div className="mb-6 p-4 border border-white/10 bg-white/[0.04] rounded-2xl space-y-3">
            <h5 className="text-sm font-bold text-red-300 uppercase tracking-wider">Create New Customer Profile</h5>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1">Full Name</label>
                <input
                  type="text"
                  placeholder="John Doe"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1">Phone Number</label>
                <input
                  type="text"
                  placeholder="9876543210"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1">Email Address</label>
                <input
                  type="email"
                  placeholder="john@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowAddForm(false)}
                className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-white/5 text-slate-400 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const nameVal = newName.trim();
                  const phoneVal = newPhone.trim();
                  const emailVal = newEmail.trim();
                  if (!nameVal || !phoneVal) {
                    alert('Name and Phone number are required.');
                    return;
                  }
                  if (phoneVal.length !== 10) {
                    alert('Phone number must be exactly 10 digits.');
                    return;
                  }

                  try {
                    const allCusts = await getServerCustomers();
                    const cleanPhone = (p: string) => p.replace(/\D/g, '');
                    const duplicate = allCusts.find((c) => cleanPhone(c.phone) === cleanPhone(phoneVal));
                    if (duplicate) {
                      alert(`A customer with phone number ${phoneVal} already exists.`);
                      return;
                    }

                    const referralCode = Math.floor(65536 + Math.random() * 983039).toString(16).toUpperCase();
                    const newCust: CustomerProfile = {
                      id: `cust_${Date.now()}`,
                      name: nameVal,
                      phone: phoneVal,
                      email: emailVal || undefined,
                      loginMethod: 'phone',
                      verified: true,
                      referralCode,
                      createdAt: new Date().toISOString(),
                      walletBalance: 0,
                      rewardPoints: 0,
                      status: 'active',
                      referralAttemptsRemaining: 3,
                      referralCodeUsed: false,
                      referralLocked: false,
                    };
                    await saveCustomerToServer(newCust);
                    alert('Customer created successfully.');
                    setShowAddForm(false);
                    onRefresh();
                  } catch (err: any) {
                    alert(err.message || 'Failed to create customer.');
                  }
                }}
                className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-green-700 hover:bg-green-600 text-white"
              >
                Create Customer
              </button>
            </div>
          </div>
        )}

        {/* Edit Customer Form */}
        {editingCustomer && (
          <div className="mb-6 p-4 border border-white/10 bg-white/[0.04] rounded-2xl space-y-3">
            <h5 className="text-sm font-bold text-red-300 uppercase tracking-wider">Edit Customer Profile</h5>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1">Full Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1">Phone Number</label>
                <input
                  type="text"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1">Email Address</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setEditingCustomer(null)}
                className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-white/5 text-slate-400 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const nameVal = newName.trim();
                  const phoneVal = newPhone.trim();
                  const emailVal = newEmail.trim();
                  if (!nameVal || !phoneVal) {
                    alert('Name and Phone number are required.');
                    return;
                  }
                  if (phoneVal.length !== 10) {
                    alert('Phone number must be exactly 10 digits.');
                    return;
                  }

                  try {
                    const allCusts = await getServerCustomers();
                    const cleanPhone = (p: string) => p.replace(/\D/g, '');
                    const duplicate = allCusts.find((c) => c.id !== editingCustomer.id && cleanPhone(c.phone) === cleanPhone(phoneVal));
                    if (duplicate) {
                      alert(`Another customer with phone number ${phoneVal} already exists.`);
                      return;
                    }

                    const updated: CustomerProfile = {
                      ...editingCustomer,
                      name: nameVal,
                      phone: phoneVal,
                      email: emailVal || undefined,
                    };
                    await saveCustomerToServer(updated);
                    alert('Customer updated successfully.');
                    setEditingCustomer(null);
                    onRefresh();
                  } catch (err: any) {
                    alert(err.message || 'Failed to update customer.');
                  }
                }}
                className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-green-700 hover:bg-green-600 text-white"
              >
                Save Changes
              </button>
            </div>
          </div>
        )}

        {/* Bulk Action Controls */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 bg-white/5 border border-white/5 rounded-2xl p-3">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={filteredCustomers.length > 0 && selectedCustomerIds.length === filteredCustomers.length}
              onChange={handleSelectAll}
              className="w-4 h-4 accent-red-500 cursor-pointer"
            />
            <span className="text-xs font-bold text-slate-350">
              {selectedCustomerIds.length} of {filteredCustomers.length} selected
            </span>
          </div>
          {selectedCustomerIds.length > 0 && (
            <button
              onClick={handleBulkRemove}
              className="rounded-xl bg-red-800 hover:bg-red-700 text-white font-bold px-3 py-1.5 text-[10px] uppercase tracking-wider transition-premium active:scale-95"
            >
              🗑️ Delete Selected
            </button>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {filteredCustomers.map((customer) => {
            const verified = StorageService.getVerifiedCustomers()[customer.id] || customer.verified;
            return (
              <div key={customer.id} className="rounded-2xl border border-white/5 bg-white/[0.05] p-4 flex flex-col justify-between shadow-2xl">
                <div>
                  <div className="font-bold flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedCustomerIds.includes(customer.id)}
                      onChange={() => handleToggleSelect(customer.id)}
                      className="w-4 h-4 accent-red-500 cursor-pointer mr-1"
                    />
                    <span className="text-white text-base">{customer.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-widest ${verified ? 'bg-green-500/20 text-green-300 border border-green-500/20' : 'bg-amber-500/20 text-amber-300 border border-amber-500/20'}`}>
                      {verified ? 'Verified' : 'Pending'}
                    </span>
                    {customer.status === 'blocked' && (
                      <span className="rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-widest bg-red-500/20 text-red-300 border border-red-500/20">
                        Blocked
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 mt-1 font-semibold">Ph: {customer.phone} {customer.email ? `• ${customer.email}` : ''}</div>
                  {customer.referralCode && (
                    <div className="text-[10px] text-red-400 mt-1 font-bold">Referral Code: {customer.referralCode}</div>
                  )}
                  {otpStatuses[customer.id] && (
                    <div className={`text-[9px] mt-1 font-bold ${otpStatuses[customer.id].success ? 'text-green-400' : 'text-red-400'}`}>
                      Last Send: {otpStatuses[customer.id].success ? '✓ Success' : '✗ Failed'} ({otpStatuses[customer.id].message}) at {new Date(otpStatuses[customer.id].timestamp).toLocaleTimeString()}
                    </div>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {!verified && (
                    <>
                      <button
                        onClick={async () => {
                          if (!confirm(`Are you sure you want to send a WhatsApp verification OTP to ${customer.name}?`)) {
                            return;
                          }
                          try {
                            const res = await sendOtpToCustomer(customer.id);
                            setOtpStatuses(prev => ({
                              ...prev,
                              [customer.id]: {
                                success: res.success,
                                message: res.message || 'OTP sent successfully.',
                                timestamp: res.timestamp || new Date().toISOString()
                              }
                            }));
                            alert(res.message || 'OTP sent successfully.');
                            onRefresh();
                          } catch (err: any) {
                            setOtpStatuses(prev => ({
                              ...prev,
                              [customer.id]: {
                                success: false,
                                message: err.message || 'Failed to send OTP.',
                                timestamp: new Date().toISOString()
                              }
                            }));
                            alert(err.message || 'Failed to send OTP.');
                          }
                        }}
                        className="rounded-xl bg-green-700 hover:bg-green-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white transition-premium active:scale-95 cursor-pointer animate-fade-in"
                      >
                        Send OTP
                      </button>
                      <button
                        onClick={() => onVerifyCustomer(customer)}
                        className="rounded-xl bg-red-650 hover:bg-red-500 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white transition-premium active:scale-95 cursor-pointer animate-fade-in"
                      >
                        Verify Manually
                      </button>
                    </>
                  )}
                  {session.role === 'admin' && (
                    <>
                      <button
                        onClick={() => {
                          setEditingCustomer(customer);
                          setShowAddForm(false);
                          setNewName(customer.name);
                          setNewPhone(customer.phone);
                          setNewEmail(customer.email || '');
                        }}
                        className="rounded-xl bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white transition-premium active:scale-95 cursor-pointer"
                      >
                        ✏️ Edit
                      </button>
                      <button
                        onClick={async () => {
                          const isBlocked = customer.status === 'blocked';
                          const nextState = !isBlocked;
                          if (confirm(`Are you sure you want to ${nextState ? 'BLOCK' : 'UNBLOCK'} ${customer.name}?`)) {
                            try {
                              await blockCustomerOnServer(customer.id, nextState);
                              alert(`Customer successfully ${nextState ? 'blocked' : 'unblocked'}.`);
                              onRefresh();
                            } catch (err: any) {
                              alert(err.message || 'Failed to toggle block state.');
                            }
                          }
                        }}
                        className={`rounded-xl px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white transition-premium active:scale-95 cursor-pointer ${customer.status === 'blocked' ? 'bg-orange-600 hover:bg-orange-500' : 'bg-orange-850 hover:bg-orange-800'}`}
                      >
                        {customer.status === 'blocked' ? '🔓 Unblock' : '🚫 Block'}
                      </button>
                      <button
                        onClick={async () => {
                          if (confirm(`Are you sure you want to REMOVE ${customer.name}? This will permanently delete their profile.`)) {
                            try {
                              await deleteCustomerFromServer(customer.id);
                              alert('Customer removed.');
                              onRefresh();
                            } catch (err: any) {
                              alert(err.message || 'Failed to delete customer.');
                            }
                          }
                        }}
                        className="rounded-xl bg-red-800 hover:bg-red-700 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white transition-premium active:scale-95 cursor-pointer"
                      >
                        🗑️ Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {filteredCustomers.length === 0 && (
            <div className="text-sm text-slate-500">No matching customers found.</div>
          )}
        </div>
      </div>

      {/* Duplicate Profile Detector */}
      {Object.keys(duplicatesGrouped).length > 0 && (
        <div className="rounded-3xl border border-red-500/20 bg-red-950/10 p-5 mb-6 animate-fade-in">
          <h4 className="font-display font-bold text-lg mb-2 text-red-300">⚠️ Duplicate Accounts Detected</h4>
          <p className="text-xs text-slate-400 mb-4">
            The following phone numbers have multiple customer profiles. Select the primary profile and merge or delete secondary ones.
          </p>
          <div className="grid gap-4">
            {Object.keys(duplicatesGrouped).map((phoneKey) => {
              const group = duplicatesGrouped[phoneKey];
              const primaryId = mergePrimaryId[phoneKey] || group[0].id;
              return (
                <div key={phoneKey} className="rounded-2xl border border-white/5 bg-white/[0.03] p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-bold text-white">Normalized Phone: +{phoneKey}</span>
                    <span className="rounded-full bg-red-500/10 text-red-400 border border-red-500/25 px-2 py-0.5 text-[10px] font-bold">
                      {group.length} duplicates
                    </span>
                  </div>
                  <div className="space-y-2">
                    {group.map((cust) => {
                      const isPrimary = cust.id === primaryId;
                      const verified = StorageService.getVerifiedCustomers()[cust.id] || cust.verified;
                      return (
                        <div key={cust.id} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-white/5 border border-white/5">
                          <div className="flex items-center gap-3">
                            <input
                              type="radio"
                              name={`primary-${phoneKey}`}
                              checked={isPrimary}
                              onChange={() => setMergePrimaryId(prev => ({ ...prev, [phoneKey]: cust.id }))}
                              className="w-4 h-4 accent-red-500 cursor-pointer"
                            />
                            <div>
                              <div className="text-xs font-bold text-white">
                                {cust.name} {isPrimary && <span className="text-green-400 font-normal ml-1">(Selected Primary)</span>}
                              </div>
                              <div className="text-[10px] text-slate-400 mt-0.5">
                                ID: {cust.id} • Balance: Rs {(cust.walletBalance ?? 0).toFixed(0)} • Reward Points: {cust.rewardPoints ?? 0} pts • {verified ? 'Verified' : 'Pending'}
                              </div>
                            </div>
                          </div>
                          {!isPrimary && (
                            <div className="flex gap-2">
                              <button
                                onClick={async () => {
                                  if (confirm(`Are you sure you want to MERGE ${cust.name} into the selected primary profile? This will add Rs ${cust.walletBalance ?? 0} and ${cust.rewardPoints ?? 0} reward points to the primary profile and permanently delete this secondary profile.`)) {
                                    try {
                                      await mergeCustomersOnServer(primaryId, cust.id);
                                      alert('Profiles merged successfully.');
                                      onRefresh();
                                    } catch (err: any) {
                                      alert(err.message || 'Failed to merge profiles.');
                                    }
                                  }
                                }}
                                className="bg-green-700 hover:bg-green-600 text-white rounded-lg px-2.5 py-1 text-[9px] font-black uppercase tracking-wider transition-all active:scale-95"
                              >
                                Merge into Primary
                              </button>
                              <button
                                onClick={async () => {
                                  if (confirm(`Are you sure you want to BLOCK duplicate profile ${cust.name}?`)) {
                                    try {
                                      await blockCustomerOnServer(cust.id, true);
                                      alert('Duplicate profile blocked.');
                                      onRefresh();
                                    } catch (err: any) {
                                      alert(err.message || 'Failed to block customer.');
                                    }
                                  }
                                }}
                                className="bg-orange-850 hover:bg-orange-800 text-white rounded-lg px-2.5 py-1 text-[9px] font-black uppercase tracking-wider transition-all active:scale-95"
                              >
                                Block
                              </button>
                              <button
                                onClick={async () => {
                                  if (confirm(`Are you sure you want to REMOVE duplicate profile ${cust.name}?`)) {
                                    try {
                                      await deleteCustomerFromServer(cust.id);
                                      alert('Duplicate profile removed.');
                                      onRefresh();
                                    } catch (err: any) {
                                      alert(err.message || 'Failed to remove customer.');
                                    }
                                  }
                                }}
                                className="bg-red-800 hover:bg-red-700 text-white rounded-lg px-2.5 py-1 text-[9px] font-black uppercase tracking-wider transition-all active:scale-95"
                              >
                                Remove
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pending Top-ups Approval Section */}
      <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-5 mb-6">
        <h4 className="font-display font-bold text-lg mb-4 text-amber-300">Pending Wallet Top-up Approvals</h4>
        <div className="grid gap-3">
          {pendingTransactions.map((tx) => (
            <div key={tx.id} className="rounded-2xl bg-white/[0.05] p-4 flex flex-wrap items-center justify-between gap-4 border border-white/5 shadow-2xl">
              <div>
                <div className="font-bold text-base text-white">{tx.customerName}</div>
                <div className="text-xs text-slate-400 font-semibold">Ph: {tx.customerPhone}</div>
                <div className="text-[10px] text-slate-500 mt-1">Requested: {new Date(tx.createdAt).toLocaleString()}</div>
                <div className="mt-1.5 text-xs font-black text-amber-300">Amount: Rs {tx.amount}</div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    if (!confirm(`Are you sure you want to APPROVE this wallet top-up request of Rs ${tx.amount} for ${tx.customerName}?`)) {
                      return;
                    }
                    try {
                      const freshCustomers = await getServerCustomers();
                      const customer = freshCustomers.find((c) => c.id === tx.customerId);
                      if (!customer) {
                        alert('Customer profile not found on server.');
                        return;
                      }
                      const updatedTx: WalletTransaction = { ...tx, status: 'completed' };
                      const updatedCustomer = { ...customer, walletBalance: (customer.walletBalance ?? 0) + tx.amount };
                      await saveWalletTransactionToServer(updatedTx);
                      await saveCustomerToServer(updatedCustomer);
                      alert(`Approved top-up of Rs ${tx.amount} for ${tx.customerName}`);
                      onRefresh();
                    } catch (err: any) {
                      alert(err.message || 'Failed to approve transaction.');
                    }
                  }}
                  className="rounded-xl bg-green-700 hover:bg-green-600 text-white font-bold px-3 py-1.5 text-[10px] uppercase tracking-wider transition-premium active:scale-95"
                >
                  Approve
                </button>
                <button
                  onClick={async () => {
                    try {
                      if (!confirm(`Are you sure you want to REJECT this top-up request of Rs ${tx.amount} for ${tx.customerName}?`)) {
                        return;
                      }
                      const updatedTx: WalletTransaction = { ...tx, status: 'failed' };
                      await saveWalletTransactionToServer(updatedTx);
                      alert(`Rejected top-up request of Rs ${tx.amount} for ${tx.customerName}`);
                      onRefresh();
                    } catch (err: any) {
                      alert(err.message || 'Failed to reject transaction.');
                    }
                  }}
                  className="rounded-xl bg-red-650 hover:bg-red-600 text-white font-bold px-3 py-1.5 text-[10px] uppercase tracking-wider transition-premium active:scale-95"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
          {pendingTransactions.length === 0 && (
            <div className="text-sm text-slate-500">No pending wallet top-up requests.</div>
          )}
        </div>
      </div>

      {/* Adjust Ledger */}
      <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-5">
        <h4 className="font-display font-bold text-lg mb-4">Adjust Balance Ledger</h4>
        <div className="grid gap-4 md:grid-cols-2">
          {filteredCustomers.map((cust) => (
            <div key={cust.id} className="rounded-2xl bg-white/[0.05] p-4 flex flex-col justify-between border border-white/5 shadow-2xl">
              <div>
                <div className="font-bold text-lg text-white">{cust.name}</div>
                <div className="text-xs text-slate-400 font-semibold">Ph: {cust.phone}</div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-2.5 text-center text-orange-200 font-bold">
                    👛 Rs {(cust.walletBalance ?? 0).toFixed(0)}
                  </div>
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-2.5 text-center text-amber-200 font-bold">
                    ⭐ {cust.rewardPoints ?? 0} pts
                  </div>
                </div>
              </div>

              {session.role === 'admin' && (
                <div className="mt-4 pt-4 border-t border-white/10 space-y-2">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Adjust Balances</div>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="Amount (+/-)"
                      id={`adj-wallet-${cust.id}`}
                      className="w-1/2 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                    />
                    <button
                      onClick={async () => {
                        const val = parseFloat((document.getElementById(`adj-wallet-${cust.id}`) as HTMLInputElement)?.value);
                        if (isNaN(val) || val === 0) return;
                        if (!confirm(`Are you sure you want to adjust the wallet balance of "${cust.name}" by Rs ${val}?`)) {
                          return;
                        }
                        const updated = { ...cust, walletBalance: Math.max(0, (cust.walletBalance ?? 0) + val) };
                        const tx: WalletTransaction = {
                          id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                          customerId: cust.id,
                          customerName: cust.name,
                          customerPhone: cust.phone,
                          amount: val,
                          type: 'admin_adjustment',
                          status: 'completed',
                          createdAt: new Date().toISOString()
                        };
                        try {
                          await saveWalletTransactionToServer(tx);
                          await saveCustomerToServer(updated);
                          (document.getElementById(`adj-wallet-${cust.id}`) as HTMLInputElement).value = '';
                          alert('Wallet adjusted.');
                          onRefresh();
                        } catch {
                          alert('Failed.');
                        }
                      }}
                      className="w-1/2 bg-red-650 hover:bg-red-600 text-white font-bold rounded-xl text-[10px] uppercase tracking-wider transition-premium active:scale-95"
                    >
                      Update Wallet
                    </button>
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="Points (+/-)"
                      id={`adj-points-${cust.id}`}
                      className="w-1/2 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                    />
                    <button
                      onClick={async () => {
                        const val = parseInt((document.getElementById(`adj-points-${cust.id}`) as HTMLInputElement)?.value, 10);
                        if (isNaN(val) || val === 0) return;
                        if (!confirm(`Are you sure you want to adjust the reward points of "${cust.name}" by ${val} points?`)) {
                          return;
                        }
                        const updated = { ...cust, rewardPoints: Math.max(0, (cust.rewardPoints ?? 0) + val) };
                        const tx: WalletTransaction = {
                          id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                          customerId: cust.id,
                          customerName: cust.name,
                          customerPhone: cust.phone,
                          amount: val * 0.1,
                          type: 'admin_adjustment',
                          status: 'completed',
                          createdAt: new Date().toISOString()
                        };
                        try {
                          await saveWalletTransactionToServer(tx);
                          await saveCustomerToServer(updated);
                          (document.getElementById(`adj-points-${cust.id}`) as HTMLInputElement).value = '';
                          alert('Points adjusted.');
                          onRefresh();
                        } catch {
                          alert('Failed.');
                        }
                      }}
                      className="w-1/2 bg-red-650 hover:bg-red-600 text-white font-bold rounded-xl text-[10px] uppercase tracking-wider transition-premium active:scale-95"
                    >
                      Update Points
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
