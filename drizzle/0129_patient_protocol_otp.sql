-- Track whether a patient session passed a possession OTP challenge.
ALTER TABLE `patient_sessions`
  ADD COLUMN `auth_method` text DEFAULT 'knowledge' NOT NULL
  CHECK (`auth_method` IN ('knowledge','otp'));
