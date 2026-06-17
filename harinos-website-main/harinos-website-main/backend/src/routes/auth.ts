import { Router } from 'express';
import { getOrderStore } from '../storage/index.js';
import { AdminUser } from '../types.js';

const router = Router();

const DEFAULT_STAFF: AdminUser[] = [
  { role: 'admin', username: 'Admin_Harinos', password: 'Harinos_Admin', outletId: null },
  { role: 'manager', username: 'Manager_Harinos', password: 'Harinos_Manager', outletId: null },
  { role: 'staff', username: 'Staff_Harinos', password: 'Harinos_Staff', outletId: null },
];

const ensureStaffSeeded = async () => {
  try {
    const store = getOrderStore();
    const existing = await store.getStaffUsers();
    if (existing.length === 0) {
      console.log('Seeding default staff users...');
      for (const user of DEFAULT_STAFF) {
        await store.saveStaffUser(user);
      }
    }
  } catch (error) {
    console.error('Error seeding staff users:', error);
  }
};

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) {
      res.status(400).json({ success: false, message: 'Missing username or password.' });
      return;
    }

    await ensureStaffSeeded();

    const staffUsers = await getOrderStore().getStaffUsers();
    const user = staffUsers.find((u) => u.username === username && u.password === password);

    if (!user) {
      res.status(401).json({ success: false, message: 'Invalid username or password.' });
      return;
    }

    res.json({
      success: true,
      user: {
        role: user.role,
        username: user.username,
        outletId: user.outletId,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/change-password', async (req, res, next) => {
  try {
    const { username, newPassword, requesterUsername, requesterPassword } = req.body as {
      username?: string;
      newPassword?: string;
      requesterUsername?: string;
      requesterPassword?: string;
    };
    if (!username || !newPassword || !requesterUsername || !requesterPassword) {
      res.status(400).json({ success: false, message: 'Missing username, newPassword, requesterUsername, or requesterPassword.' });
      return;
    }

    const store = getOrderStore();
    const staff = await store.getStaffUsers();

    // Verify requester is an admin with the correct password
    const requester = staff.find((u) => u.username === requesterUsername && u.password === requesterPassword);
    if (!requester || requester.role !== 'admin') {
      res.status(403).json({ success: false, message: 'Unauthorized. Only the admin can change passwords.' });
      return;
    }

    const user = staff.find((u) => u.username === username);
    if (!user) {
      res.status(404).json({ success: false, message: 'Staff user not found.' });
      return;
    }

    user.password = newPassword;
    await store.saveStaffUser(user);

    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (error) {
    next(error);
  }
});

export default router;
