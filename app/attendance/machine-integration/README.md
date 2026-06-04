# Punching Machine Integration

This directory is reserved for integrating hardware punching machines (biometric/RFID) with the HR System.

## Planned Features
- API Endpoint to receive punch data from devices.
- Middleware to parse proprietary device formats (e.g., ZKTecho).
- Synchronization logic to map Device User ID to System Employee ID.

## Next Steps
1. Identify the specific hardware model and SDK.
2. Create an API route (e.g., `/api/attendance/sync`).
3. Setup a background job to pull logs periodically.
