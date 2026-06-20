from django.urls import path
from . import views

urlpatterns = [
    # Auth
    path('auth/login', views.auth_login, name='auth_login'),
    path('auth/change-password', views.auth_change_password, name='auth_change_password'),
    
    # Notifications
    path('notifications', views.register_notification_token, name='register_notification_token'),
    
    # App settings
    path('settings', views.app_settings, name='app_settings'),
    
    # Menu, Outlets, Offers
    path('menu-items', views.menu_items, name='menu_items'),
    path('outlets', views.outlets, name='outlets'),
    path('offers', views.offers, name='offers'),
    
    # Wallet transactions
    path('wallet/transactions', views.wallet_transactions, name='wallet_transactions'),
    
    # Customers
    path('customers', views.customers_endpoint, name='customers_endpoint'),
    
    # Orders
    path('orders', views.orders_endpoint, name='orders_endpoint'),
    path('orders/<str:order_id>', views.order_detail, name='order_detail'),
    path('orders/<str:order_id>/status', views.order_detail, name='order_detail_status'),
    
    # Admin Backups
    path('admin/backup', views.backups_endpoint, name='admin_backup'),
    path('admin/backup-list', views.backups_endpoint, name='admin_backup_list'),
    path('admin/restore', views.restore_endpoint, name='admin_restore'),
]
