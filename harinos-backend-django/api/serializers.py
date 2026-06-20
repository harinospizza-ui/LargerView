from rest_framework import serializers

class JSONPayloadSerializer(serializers.BaseSerializer):
    def to_representation(self, instance):
        return instance.payload
