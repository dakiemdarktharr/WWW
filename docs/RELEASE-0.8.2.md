# Kivuno 0.8.2

## Windows installer

An upgrade could stop while preparing recovery files when Windows still had a registry entry for an older installation whose folder or uninstaller had been removed. The setup message incorrectly suggested that the drive was full or unwritable.

The installer now treats a missing old uninstaller as a fresh install. When the old uninstaller is present, it prefers the user's Windows TEMP folder when that folder shares the installation volume, avoiding synced or protected install parents. For installs on another volume, it keeps staging on the install volume when possible and falls back to TEMP.

## Verification

The Windows NSIS probe compiled and exercised a successful upgrade, retained recovery after an old uninstaller failure, a missing old uninstaller, a failed staging location, environment restoration, and same-volume TEMP preference.
