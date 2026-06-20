from django.core.management.base import BaseCommand
from api.models import StaffUser
from api.authentication import hash_password

class Command(BaseCommand):
    help = 'Create a secure staff/admin user in the database'

    def add_arguments(self, parser):
        parser.add_argument('--username', type=str, required=True, help='Username of the staff user')
        parser.add_argument('--password', type=str, required=True, help='Password of the staff user')
        parser.add_argument('--role', type=str, required=True, choices=['admin', 'manager', 'staff'], help='Role of the staff user')
        parser.add_argument('--outlet-id', type=str, default=None, help='Associated Outlet ID (optional)')

    def handle(self, *args, **options):
        username = options['username'].strip()
        password = options['password']
        role = options['role']
        outlet_id = options['outlet_id']

        if StaffUser.objects.filter(username=username).exists():
            self.stdout.write(self.style.ERROR(f"Error: User '{username}' already exists."))
            return

        hashed_pw = hash_password(password)
        payload = {
            'username': username,
            'role': role,
            'password': hashed_pw,
            'outletId': outlet_id
        }

        StaffUser.objects.create(
            username=username,
            role=role,
            payload=payload
        )
        self.stdout.write(self.style.SUCCESS(f"Successfully created {role} user '{username}'."))
