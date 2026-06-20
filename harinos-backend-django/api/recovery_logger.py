import os
import json
from datetime import datetime

RECOVERY_LOG_DIR = "C:\\harinos-backups"
RECOVERY_LOG_FILE = os.path.join(RECOVERY_LOG_DIR, "recovery.log")

def ensure_recovery_log():
    os.makedirs(RECOVERY_LOG_DIR, exist_ok=True)
    if not os.path.exists(RECOVERY_LOG_FILE):
        with open(RECOVERY_LOG_FILE, 'w', encoding='utf-8') as f:
            f.write(json.dumps({}) + "\n")

def log_transaction(tx_id, tx_type, payload):
    try:
        ensure_recovery_log()
        with open(RECOVERY_LOG_FILE, 'r', encoding='utf-8') as f:
            data = json.loads(f.read().strip() or "{}")
        
        data[tx_id] = {
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'type': tx_type,
            'payload': payload,
            'completed': False
        }
        
        with open(RECOVERY_LOG_FILE, 'w', encoding='utf-8') as f:
            f.write(json.dumps(data, indent=2) + "\n")
    except Exception as e:
        print("[-] Failsafe log failed:", e)

def complete_transaction(tx_id):
    try:
        ensure_recovery_log()
        with open(RECOVERY_LOG_FILE, 'r', encoding='utf-8') as f:
            data = json.loads(f.read().strip() or "{}")
            
        if tx_id in data:
            # Delete transaction on completion to keep log clean
            del data[tx_id]
            
        with open(RECOVERY_LOG_FILE, 'w', encoding='utf-8') as f:
            f.write(json.dumps(data, indent=2) + "\n")
    except Exception as e:
        print("[-] Failsafe complete log failed:", e)

def get_pending_transactions():
    try:
        ensure_recovery_log()
        if not os.path.exists(RECOVERY_LOG_FILE):
            return {}
        with open(RECOVERY_LOG_FILE, 'r', encoding='utf-8') as f:
            content = f.read().strip()
            if not content:
                return {}
            return json.loads(content)
    except Exception as e:
        print("[-] Failsafe read pending logs failed:", e)
        return {}
