from django.db import models

class MenuItem(models.Model):
    id = models.CharField(max_length=64, primary_key=True)
    payload = models.JSONField()
    available = models.BooleanField(default=True)

    def __str__(self):
        return self.id


class Outlet(models.Model):
    id = models.CharField(max_length=64, primary_key=True)
    payload = models.JSONField()
    enabled = models.BooleanField(default=True)

    def __str__(self):
        return self.id


class Offer(models.Model):
    id = models.CharField(max_length=64, primary_key=True)
    payload = models.JSONField()
    enabled = models.BooleanField(default=True)

    def __str__(self):
        return self.id


class Customer(models.Model):
    id = models.CharField(max_length=128, primary_key=True)
    payload = models.JSONField()
    phone = models.CharField(max_length=32, db_index=True)
    email = models.CharField(max_length=255, null=True, blank=True)
    verified = models.BooleanField(default=False)
    created_at = models.DateTimeField(db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.id} ({self.phone})"


class Order(models.Model):
    id = models.CharField(max_length=64, primary_key=True)
    payload = models.JSONField()
    status = models.CharField(max_length=32, db_index=True)
    received_at = models.DateTimeField(db_index=True)
    outlet_id = models.CharField(max_length=128, null=True, blank=True, db_index=True)
    customer_phone = models.CharField(max_length=32, null=True, blank=True, db_index=True)
    total = models.DecimalField(max_digits=10, decimal_places=2, default=0.0)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.id


class WalletTransaction(models.Model):
    id = models.CharField(max_length=64, primary_key=True)
    payload = models.JSONField()
    created_at = models.DateTimeField(db_index=True)

    def __str__(self):
        return self.id


class Setting(models.Model):
    id = models.CharField(max_length=64, primary_key=True)
    payload = models.JSONField()

    def __str__(self):
        return self.id


class BlockedCustomer(models.Model):
    phone = models.CharField(max_length=32, primary_key=True)
    blocked_at = models.DateTimeField()
    customer_id = models.CharField(max_length=128)
    name = models.CharField(max_length=255)

    def __str__(self):
        return f"{self.phone} - {self.name}"


class StaffUser(models.Model):
    username = models.CharField(max_length=128, primary_key=True)
    payload = models.JSONField()
    role = models.CharField(max_length=32)

    def __str__(self):
        return self.username


class NotificationToken(models.Model):
    id = models.CharField(max_length=255, primary_key=True)
    user_id = models.CharField(max_length=128, db_index=True)
    fcm_token = models.TextField()
    role = models.CharField(max_length=32, db_index=True)
    outlet_id = models.CharField(max_length=128, null=True, blank=True, db_index=True)
    device_type = models.CharField(max_length=64, default='browser')
    device_info = models.JSONField(default=dict)
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()
    last_used_at = models.DateTimeField()

    def __str__(self):
        return self.id
