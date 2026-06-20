import os
import sys
import json
import base64
import subprocess
from pathlib import Path

def create_scheduler_task(ssd_path):
    monitor_script = os.path.join(ssd_path, "ssd_monitor.ps1")
    task_name = "HarinosPizzaDbMonitor"
    
    # Check if the script exists
    if not os.path.exists(monitor_script):
        print(f"[-] Monitor script not found at {monitor_script}")
        return False
        
    print(f"[*] Registering Task Scheduler task '{task_name}'...")
    
    # Register task to run silently at user logon with HIGHEST PRIVILEGES (Administrator)
    cmd = [
        "schtasks",
        "/create",
        "/tn", task_name,
        "/tr", f"powershell.exe -WindowStyle Hidden -File {monitor_script}",
        "/sc", "onlogon",
        "/rl", "highest",
        "/f"
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        print("[+] Task registered successfully! Services will now start/stop dynamically on SSD insert.")
        return True
    except subprocess.CalledProcessError as e:
        print(f"[-] Failed to register task: {e.stderr}")
        return False

def main():
    print("=== Harino's Pizza Plug-and-Play Setup Installer ===")
    
    # 1. Identify SSD path
    ssd_path = "D:\\WEB_SERVER"
    if not os.path.exists(ssd_path):
        # Scan other drives
        for letter in ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']:
            test_p = f"{letter}:\\WEB_SERVER"
            if os.path.exists(test_p):
                ssd_path = test_p
                break
    
    if not os.path.exists(ssd_path):
        print("[-] Error: External SSD 'WEB_SERVER' folder not found. Please connect the SSD first.")
        sys.exit(1)
        
    print(f"[+] Found External SSD storage at: {ssd_path}")
    
    # 2. Extract Firebase Credentials
    encoded_fcm = os.getenv('FIREBASE_SERVICE_ACCOUNT_BASE64')
    raw_fcm = os.getenv('FIREBASE_SERVICE_ACCOUNT_JSON')
    fcm_dict = None
    
    if encoded_fcm:
        try:
            fcm_dict = json.loads(base64.b64decode(encoded_fcm).decode('utf-8'))
            print("[+] Successfully read Firebase Service Account from Base64 env variable.")
        except Exception as e:
            print(f"[-] Error decoding Base64 credentials: {e}")
            
    if not fcm_dict and raw_fcm:
        try:
            fcm_dict = json.loads(raw_fcm)
            print("[+] Successfully read Firebase Service Account from JSON env variable.")
        except Exception as e:
            print(f"[-] Error parsing raw JSON credentials: {e}")
            
    if not fcm_dict:
        # Check if they are already in the project workspace or locally
        backup_cred_file = Path(__file__).parent / "firebase_credentials.json"
        if backup_cred_file.exists():
            with open(backup_cred_file, 'r') as f:
                fcm_dict = json.load(f)
            print("[+] Loaded Firebase credentials from local backup file.")
            
    if not fcm_dict:
        print("[!] Warning: Firebase Credentials not found in environment or local backup files.")
        print("    FCM push notifications will be bypassed/disabled, but database operations will run fully local.")
    else:
        # Write credentials directly to SSD
        cred_output_path = os.path.join(ssd_path, "firebase_credentials.json")
        with open(cred_output_path, 'w', encoding='utf-8') as f:
            json.dump(fcm_dict, f, indent=2)
        print(f"[+] Written Firebase credentials to: {cred_output_path}")
    
    # 3. Extract or Generate JWT_SECRET
    jwt_secret = os.getenv('JWT_SECRET')
    if not jwt_secret:
        jwt_secret = "dev-harinos-pizza-secret-key-32-chars-minimum-fallback"
        print("[*] JWT_SECRET not found in env, using standard development fallback.")
    else:
        print("[+] Captured JWT_SECRET from environment.")
        
    # 4. Generate harinos-config.json
    config_dict = {
        "JWT_SECRET": jwt_secret,
        "MYSQL_DATABASE": "harinos_orders",
        "MYSQL_USER": "root",
        "MYSQL_PASSWORD": "",
        "MYSQL_HOST": "127.0.0.1",
        "MYSQL_PORT": 3306,
        "DEBUG": True,
        "SSD_ROOT": ssd_path
    }
    
    config_output_path = os.path.join(ssd_path, "harinos-config.json")
    with open(config_output_path, 'w', encoding='utf-8') as f:
        json.dump(config_dict, f, indent=2)
    print(f"[+] Written local configurations to: {config_output_path}")
    
    # 5. Create Task Scheduler Automation
    success = create_scheduler_task(ssd_path)
    if success:
        print("\n[+] Setup Completed Successfully!")
        print("[+] True Plug-and-Play mode is active. Simply connect your SSD to start the server.")
    else:
        print("\n[-] Setup completed with warnings. Could not register automatic background service.")
        print("    Please run this command inside an Administrator terminal to authorize scheduling.")

if __name__ == '__main__':
    main()
