import json
import os
import time
from datetime import datetime
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils.dateparse import parse_datetime
from django.utils import timezone
from api.models import Order, Customer, WalletTransaction
from api.recovery_logger import get_pending_transactions, complete_transaction

class Command(BaseCommand):
    help = 'Replays any pending database transactions from the recovery log'

    def handle(self, *args, **options):
        pending = get_pending_transactions()
        if not pending:
            self.stdout.write(self.style.SUCCESS("No pending transactions to replay."))
            return

        self.stdout.write(self.style.WARNING(f"Found {len(pending)} pending transactions to replay."))

        for tx_id, tx_info in sorted(pending.items(), key=lambda x: x[1].get('timestamp', '')):
            tx_type = tx_info.get('type')
            payload = tx_info.get('payload')

            self.stdout.write(f"Replaying {tx_id} ({tx_type})...")
            try:
                with transaction.atomic():
                    if tx_type == 'wallet_transaction':
                        tx = payload
                        created_str = tx.get('createdAt') or datetime.utcnow().isoformat() + 'Z'
                        WalletTransaction.objects.update_or_create(
                            id=tx_id,
                            defaults={
                                'payload': tx,
                                'created_at': parse_datetime(created_str) or timezone.now()
                            }
                        )
                        cust_id = tx.get('customerId')
                        amount = float(tx.get('amount', 0))
                        if cust_id:
                            try:
                                cust = Customer.objects.get(id=cust_id)
                                p = cust.payload
                                current_bal = float(p.get('walletBalance', 0))
                                p['walletBalance'] = current_bal + amount
                                cust.payload = p
                                cust.save()
                            except Customer.DoesNotExist:
                                pass

                    elif tx_type == 'apply_referral':
                        customer_id = payload.get('customerId')
                        referral_code = payload.get('referralCode', '').strip().upper()
                        try:
                            cust = Customer.objects.get(id=customer_id)
                            p = cust.payload
                            if not p.get('referralCodeUsed') and not p.get('referralApplied'):
                                referrer = None
                                for c in Customer.objects.exclude(id=customer_id):
                                    if c.payload.get('referralCode', '').upper() == referral_code:
                                        referrer = c
                                        break
                                if referrer:
                                    # 1. Update target customer
                                    p['referralCodeUsed'] = True
                                    p['referralApplied'] = True
                                    p['referralAppliedAt'] = datetime.utcnow().isoformat() + 'Z'
                                    p['walletBalance'] = float(p.get('walletBalance', 0)) + 50.0
                                    cust.payload = p
                                    cust.save()

                                    # 2. Update referrer customer
                                    ref_payload = referrer.payload
                                    ref_payload['walletBalance'] = float(ref_payload.get('walletBalance', 0)) + 50.0
                                    referrer.payload = ref_payload
                                    referrer.save()

                                    # 3. Create wallet transaction logs
                                    now_str = datetime.utcnow().isoformat() + 'Z'
                                    tx1_id = f"tx_ref1_{int(time.time()*1000)}"
                                    WalletTransaction.objects.update_or_create(
                                        id=tx1_id,
                                        defaults={
                                            'created_at': timezone.now(),
                                            'payload': {
                                                'id': tx1_id,
                                                'customerId': cust.id,
                                                'customerName': p.get('name'),
                                                'customerPhone': p.get('phone'),
                                                'amount': 50.0,
                                                'type': 'reward',
                                                'status': 'completed',
                                                'createdAt': now_str
                                            }
                                        }
                                    )
                                    tx2_id = f"tx_ref2_{int(time.time()*1000)}"
                                    WalletTransaction.objects.update_or_create(
                                        id=tx2_id,
                                        defaults={
                                            'created_at': timezone.now(),
                                            'payload': {
                                                'id': tx2_id,
                                                'customerId': referrer.id,
                                                'customerName': ref_payload.get('name'),
                                                'customerPhone': ref_payload.get('phone'),
                                                'amount': 50.0,
                                                'type': 'reward',
                                                'status': 'completed',
                                                'createdAt': now_str
                                            }
                                        }
                                    )
                        except Customer.DoesNotExist:
                            pass

                    elif tx_type == 'order_placement':
                        order = payload
                        order_id = order.get('id')
                        received_str = order.get('receivedAt') or order.get('date') or datetime.utcnow().isoformat() + 'Z'
                        Order.objects.update_or_create(
                            id=order_id,
                            defaults={
                                'payload': order,
                                'status': order.get('status', 'new'),
                                'received_at': parse_datetime(received_str) or timezone.now(),
                                'outlet_id': order.get('outletId'),
                                'customer_phone': order.get('customerPhone'),
                                'total': float(order.get('total', 0))
                            }
                        )

                    elif tx_type == 'order_status_update':
                        order_id = payload.get('orderId')
                        new_status = payload.get('status')
                        reason = payload.get('reason')
                        updated_by = payload.get('updatedBy', 'system')
                        try:
                            ord_obj = Order.objects.get(id=order_id)
                            p = ord_obj.payload
                            old_status = p.get('status', 'new')
                            p['status'] = new_status
                            p['statusUpdatedAt'] = datetime.utcnow().isoformat() + 'Z'
                            if reason:
                                p['cancellationReason'] = reason
                            trail = p.get('auditTrail', [])
                            trail.append({
                                'timestamp': datetime.utcnow().isoformat() + 'Z',
                                'updatedBy': updated_by,
                                'action': f"Status updated from {old_status} to {new_status} (recovered)",
                                'previousStatus': old_status,
                                'newStatus': new_status,
                                'reason': reason
                            })
                            p['auditTrail'] = trail
                            ord_obj.payload = p
                            ord_obj.status = new_status
                            ord_obj.save()
                        except Order.DoesNotExist:
                            pass

                # Mark transaction as completed in recovery log
                complete_transaction(tx_id)
                self.stdout.write(self.style.SUCCESS(f"Successfully replayed {tx_id}"))
            except Exception as e:
                self.stdout.write(self.style.ERROR(f"Failed to replay {tx_id}: {e}"))
