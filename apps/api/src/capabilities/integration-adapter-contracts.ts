/** Integration ports reserved for the later CUSTOMER mobile identity rollout. */
export interface CustomerMobileAuthenticationAdapter {
  authenticate(input: { credential: string }): Promise<{ customerId: string }>;
}

/** Integration port reserved for the later SMS OTP provider rollout. */
export interface SmsOtpDeliveryAdapter {
  send(input: { phoneNumber: string; code: string; expiresAt: Date; purpose: 'CONTRACT_COMPLETION' }): Promise<void>;
}
