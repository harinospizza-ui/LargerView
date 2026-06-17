import { AdminRole } from './types';

export interface AdminUser {
  role: AdminRole;
  username: string;
  password: string;
  outletId: string | null;
}
