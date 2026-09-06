# Device Management Foundation

Device management is a future optional layer. It must never be required to make an offline sale.

Local settings already expose device name, device id, version/about and storage health. The future device record may include installation id, application version, last online time, last backup, database size, free disk, printer health and app health.

Two future layers are documented separately:

1. CpIPOS application management for app health, backup status and visible support workflows.
2. Windows enterprise MDM integration for organization-managed Windows devices.

Remote support must be visible and user-consented. Do not implement stealth remote desktop or arbitrary remote command execution.

This task intentionally does not implement an updater, cloud sync, Supabase, Vercel API or remote command runner.