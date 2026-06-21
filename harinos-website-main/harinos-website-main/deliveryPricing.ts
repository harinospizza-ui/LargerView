import { OutletConfig } from './types';

export interface DeliveryPricingSummary {
  fee: number;
  isServiceable: boolean;
  isFreeDelivery: boolean;
  requiredMinimumOrder: number | null;
  distanceBandKm: number | null;
  shortfall: number | null;
}

const getDistanceBandKm = (distanceKm: number, outlet: OutletConfig): number => {
  const roundedDistanceKm = Math.ceil(Math.max(distanceKm, 0));
  return Math.max(
    outlet.freeDeliveryRadiusKm,
    Math.min(outlet.deliveryRadiusKm, roundedDistanceKm),
  );
};

export const getRequiredMinimumOrderForDistance = (
  outlet: OutletConfig,
  distanceKm: number,
): number => {
  const distanceBandKm = getDistanceBandKm(distanceKm, outlet);
  const additionalKm = Math.max(0, distanceBandKm - outlet.freeDeliveryRadiusKm);

  return outlet.freeDeliveryMinimumOrder + additionalKm * outlet.minimumOrderIncrementPerKm;
};

export const getDeliveryPricingSummary = (
  outlet: OutletConfig | null,
  distanceKm: number | null,
  subtotal: number,
): DeliveryPricingSummary => {
  if (!outlet || distanceKm === null) {
    return {
      fee: 0,
      isServiceable: true,
      isFreeDelivery: false,
      requiredMinimumOrder: null,
      distanceBandKm: null,
      shortfall: null,
    };
  }

  if (distanceKm > 5 || distanceKm > outlet.deliveryRadiusKm) {
    return {
      fee: -1,
      isServiceable: false,
      isFreeDelivery: false,
      requiredMinimumOrder: null,
      distanceBandKm: null,
      shortfall: null,
    };
  }

  const requiredMinimumOrder = getRequiredMinimumOrderForDistance(outlet, distanceKm);
  const isFreeDelivery = subtotal >= requiredMinimumOrder;
  const fee = isFreeDelivery ? 0 : Math.round(distanceKm * outlet.deliveryChargePerKm);

  return {
    fee,
    isServiceable: true,
    isFreeDelivery,
    requiredMinimumOrder,
    distanceBandKm: getDistanceBandKm(distanceKm, outlet),
    shortfall: isFreeDelivery ? 0 : requiredMinimumOrder - subtotal,
  };
};
