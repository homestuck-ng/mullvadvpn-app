use std::time::Duration;

use mullvad_types::settings::{
    DEVICE_CLEANUP_MAX_INTERVAL, DEVICE_CLEANUP_MIN_INTERVAL, DeviceCleanupSettings,
};

use crate::types::{FromProtobufTypeError, proto};

impl From<&DeviceCleanupSettings> for proto::DeviceCleanupSettings {
    fn from(settings: &DeviceCleanupSettings) -> Self {
        Self {
            enabled: settings.enabled,
            interval_secs: settings.interval.as_secs(),
            excluded_device_ids: settings.excluded_devices.clone(),
        }
    }
}

impl TryFrom<proto::DeviceCleanupSettings> for DeviceCleanupSettings {
    type Error = FromProtobufTypeError;

    fn try_from(settings: proto::DeviceCleanupSettings) -> Result<Self, Self::Error> {
        let interval = Duration::from_secs(settings.interval_secs);

        if interval < DEVICE_CLEANUP_MIN_INTERVAL {
            return Err(FromProtobufTypeError::invalid_argument(
                "device cleanup kick cooldown must be at least 1 second",
            ));
        }
        if interval > DEVICE_CLEANUP_MAX_INTERVAL {
            return Err(FromProtobufTypeError::invalid_argument(
                "device cleanup kick cooldown must be at most 3600 seconds",
            ));
        }

        Ok(Self {
            enabled: settings.enabled,
            interval,
            excluded_devices: settings.excluded_device_ids,
        })
    }
}
