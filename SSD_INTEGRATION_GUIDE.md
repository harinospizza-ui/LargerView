# Harino's Pizza SSD Storage & Startup Integration Guide

This guide details how to prepare, run, and maintain the hybrid local database setup for Harino's Pizza, keeping Firestore exclusively for push notifications and running all active orders, customer wallets, settings, and transactions on a local MySQL database physically placed on an External SSD.

---

## 1. SSD Preparation

1. **File System**: Format your external SSD using **NTFS** or **exFAT** (NTFS is recommended for Windows since it supports file permissions and larger file size transactions).
2. **Drive Naming**: Connect the SSD to the laptop and assign it a clear Volume Label (e.g. `HARINOS_SSD`). While the drive letter may shift (e.g., from `D:` to `E:` or `F:`), the automated monitor script will search for the signature marker file to locate the SSD.
3. **Signature File**: Create a file named `harinos_ssd_marker.txt` at the root of the folder named `WEB_SERVER` on the SSD (i.e. `D:\WEB_SERVER\harinos_ssd_marker.txt`). This file contains:
   ```text
   HARINOS_PIZZA_HYBRID_STORAGE_SSD_MARKER_FILE
   ```

---

## 2. SSD Folder Structure

Organize the `WEB_SERVER` folder on your SSD exactly as follows:

```text
D:\WEB_SERVER\
├── harinos_ssd_marker.txt        # Marker signature file (used for auto-detection)
├── ssd_monitor.ps1               # Auto-startup monitoring PowerShell script
├── migrate_firestore_to_mysql.py # Firestore-to-MySQL data migration script
├── manage.py                     # Django project manager script
├── harinos_backend/              # Django settings and main project configurations
│   ├── settings.py
│   ├── urls.py
│   └── wsgi.py
├── api/                          # Django models, views, and controllers
│   ├── models.py
│   ├── views.py
│   ├── authentication.py
│   └── urls.py
├── harinos-mysql/                # Portable MySQL Server Binaries (unzipped)
│   ├── bin/                      # Contains mysqld.exe, mysqldump.exe, mysql.exe
│   ├── data/                     # Database storage directory (resides on SSD)
│   └── my.ini                    # MySQL configuration file
└── harinos-backups/              # Local backup folder for SQL exports
```

---

## 3. MySQL Installation & Data Placement on SSD

1. **Download Portable MySQL**:
   - Download the MySQL Community Server ZIP archive for Windows (e.g. `mysql-8.x-winx64.zip`) from the official site.
   - Extract the contents to the folder `D:\WEB_SERVER\harinos-mysql` on your SSD.
2. **Configuration File**:
   - Save the `my.ini` configuration file inside `D:\WEB_SERVER\harinos-mysql\my.ini`.
   - The monitor script will automatically rewrite the drive letter (e.g. `D:`, `E:`, `F:`) inside `my.ini` on startup to match the active drive letter.
3. **Initialize Database Directory**:
   - Open Command Prompt as Administrator, navigate to your SSD MySQL bin directory and initialize the database directory:
     ```cmd
     cd /d D:\WEB_SERVER\harinos-mysql\bin
     mysqld.exe --defaults-file=..\my.ini --initialize-insecure --console
     ```
   - This creates the root user without a password and sets up initial system tables in `harinos-mysql\data`.

---

## 4. Automatic Startup & SSD Detection System

A PowerShell script `ssd_monitor.ps1` runs in the background on the laptop. It polls connected logical drives every 3 seconds for the `WEB_SERVER\harinos_ssd_marker.txt` signature:

* **When SSD is connected**:
  1. The script identifies the new drive letter (e.g., `E:`).
  2. Updates `my.ini` paths dynamically to reflect the current drive letter.
  3. Launches the portable MySQL Server (`mysqld.exe`) in the background.
  4. Runs Django migrations to ensure tables are up-to-date.
  5. Starts the Django API Server (`python manage.py runserver 127.0.0.1:8000`).
  6. Displays a Windows balloon alert: *"Harino's Pizza Database Connected! Services are running automatically."*

* **When SSD is disconnected**:
  1. The script immediately detects that the signature file is no longer accessible.
  2. Force terminates the Django Python process and the `mysqld` process.
  3. Displays a warning desktop prompt: *"External SSD disconnected! Database services stopped immediately. No database files remain accessible on the laptop."*

### Setting up automatic startup on Windows boot:
To have `ssd_monitor.ps1` launch automatically when the laptop boots:
1. Open the **Startup Folder** by pressing `Win + R`, typing `shell:startup`, and hitting Enter.
2. Right-click and choose **New -> Shortcut**.
3. Set the target of the shortcut to run PowerShell in the background:
   ```cmd
   powershell.exe -WindowStyle Hidden -File "D:\WEB_SERVER\ssd_monitor.ps1"
   ```
   *(Update the drive letter in the shortcut path to point to your script location)*

---

## 5. Firestore-to-MySQL Migration

To move your existing Firestore data to the MySQL database on the SSD without losing any customer balances, orders, or credentials:

1. Ensure the SSD is connected and the database is active.
2. Set your Google Firebase Service Account Base64 credential in your environment:
   ```cmd
   set FIREBASE_SERVICE_ACCOUNT_BASE64=your_base64_string_here
   ```
3. Run the migration script:
   ```cmd
   python D:\WEB_SERVER\migrate_firestore_to_mysql.py
   ```
4. The script prints a detailed comparison count between Firestore records and MySQL tables to verify 100% data fidelity.

---

## 6. Backup & Restore Operations

### Backup Configuration
When the Admin clicks the **Create Full Backup** button in the Admin Panel:
1. The Django backend calls `mysqldump` to export a full SQL snapshot.
2. Saves a primary copy to `D:\WEB_SERVER\harinos-backups\Backup_YYYY-MM-DD_HH-MM.sql`.
3. Copies a secondary backup to the Laptop internal drive: `C:\harinos-backups\Backup_YYYY-MM-DD_HH-MM.sql`.
4. Saves metadata (timestamp, size, and file path) to display in the backup history list.

### Restore Procedure
When the Admin selects a file and clicks **Restore** on the dashboard:
1. The system creates an **Emergency Rollback Point** on the SSD (`Backup_Emergency_YYYY-MM-DD_HH-MM.sql`).
2. Performs an integrity check on the selected backup (verifying SQL format headers).
3. Restores database tables.

### Recovery Procedure
If a database restoration goes wrong or data corruption is detected:
1. Open the Backup History.
2. Select the emergency backup file (`Backup_Emergency_*.sql`) created right before the restore.
3. Click **Restore** to roll back to the exact previous state.

---

## 7. Safe SSD Removal Procedure

1. Before unplugging the SSD, close any open browser tabs running the admin panel.
2. Unplug the USB cable.
3. The PowerShell monitor script immediately kills the MySQL and Django services and displays the storage alert prompt.
4. Your database data is now physically secure and disconnected.
