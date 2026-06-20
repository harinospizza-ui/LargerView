from rest_framework import serializers

class JSONPayloadSerializer(serializers.BaseSerializer):
    def to_representation(self, instance):
        payload = instance.payload
        if isinstance(payload, dict):
            payload = payload.copy()
            payload.pop('otp', None)
            payload.pop('otpExpiry', None)
        return payload
