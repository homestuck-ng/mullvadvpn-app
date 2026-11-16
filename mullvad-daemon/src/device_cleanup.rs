use std::time::Duration;

use futures::future::join_all;
use mullvad_types::{
    device::{Device, RemoveDeviceEvent},
    settings::{DEVICE_CLEANUP_MIN_INTERVAL, DeviceCleanupSettings},
};
use tokio::sync::watch;

use crate::{
    device::AccountManagerHandle, management_interface::ManagementInterfaceEventBroadcaster,
};

/// How long to wait before checking again if cleanup could not run because no device is logged in.
const RETRY_WHEN_IDLE: Duration = Duration::from_secs(5);

/// Spawn a task that continuously removes every device except the current one and the exclusions.
///
/// Enabling the feature takes effect on the next loop wake (settings watch). The kick cooldown comes
/// from [`DeviceCleanupSettings::interval`]. Removals for one poll run in parallel.
pub(crate) fn spawn(
    account_manager: AccountManagerHandle,
    mut settings_rx: watch::Receiver<DeviceCleanupSettings>,
    notifier: ManagementInterfaceEventBroadcaster,
) {
    tokio::spawn(async move {
        loop {
            let settings = settings_rx.borrow_and_update().clone();

            if !settings.enabled {
                if wait_for_change_or_timeout(&mut settings_rx, RETRY_WHEN_IDLE)
                    .await
                    .is_err()
                {
                    return;
                }
                continue;
            }

            kick_unauthorized_devices(&account_manager, &settings, &notifier).await;

            let cooldown = settings.interval.clamp(
                DEVICE_CLEANUP_MIN_INTERVAL,
                mullvad_types::settings::DEVICE_CLEANUP_MAX_INTERVAL,
            );
            if wait_for_change_or_timeout(&mut settings_rx, cooldown)
                .await
                .is_err()
            {
                return;
            }
        }
    });
}

/// List account devices and remove every device that is not the current device or excluded.
async fn kick_unauthorized_devices(
    account_manager: &AccountManagerHandle,
    settings: &DeviceCleanupSettings,
    notifier: &ManagementInterfaceEventBroadcaster,
) {
    let state = match account_manager.data().await {
        Ok(state) => state,
        Err(error) => {
            log::error!("Failed to read device state during automatic device cleanup: {error}");
            return;
        }
    };

    let Some(current_device) = state.device() else {
        return;
    };
    let account_number = current_device.account_number.clone();
    let current_device_id = current_device.device.id.clone();

    let devices = match account_manager
        .device_service
        .list_devices(account_number.clone())
        .await
    {
        Ok(devices) => devices,
        Err(error) => {
            log::error!("Failed to list devices during automatic device cleanup: {error}");
            return;
        }
    };

    // Only remove devices if the current device is in the list. Otherwise we may be looking at a
    // stale or unrelated device list, and removing devices could affect the wrong account.
    if !devices.iter().any(|device| device.id == current_device_id) {
        log::warn!(
            "Current device is missing from the device list. Skipping automatic device cleanup"
        );
        return;
    }

    let targets: Vec<&Device> = devices
        .iter()
        .filter(|device| {
            device.id != current_device_id && !settings.excluded_devices.contains(&device.id)
        })
        .collect();

    if targets.is_empty() {
        return;
    }

    for device in &targets {
        log::info!(
            "Automatically removing device '{}' ({})",
            device.pretty_name(),
            device.id
        );
    }

    let removals = targets.iter().map(|device| {
        let service = account_manager.device_service.clone();
        let account_number = account_number.clone();
        let device_id = device.id.clone();
        async move {
            service
                .remove_device_only(account_number, device_id)
                .await
        }
    });

    let results = join_all(removals).await;
    let mut removed_any = false;
    for result in results {
        match result {
            Ok(()) => removed_any = true,
            Err(error) => log::error!("Failed to automatically remove device: {error}"),
        }
    }

    if !removed_any {
        return;
    }

    match account_manager
        .device_service
        .list_devices(account_number.clone())
        .await
    {
        Ok(new_devices) => {
            notifier.notify_remove_device_event(RemoveDeviceEvent {
                account_number,
                new_devices,
            });
        }
        Err(error) => {
            log::error!(
                "Failed to list devices after automatic device cleanup: {error}"
            );
        }
    }
}

async fn wait_for_change_or_timeout(
    settings_rx: &mut watch::Receiver<DeviceCleanupSettings>,
    timeout: Duration,
) -> Result<(), ()> {
    tokio::select! {
        _ = tokio::time::sleep(timeout) => Ok(()),
        changed = settings_rx.changed() => changed.map_err(|_| ()),
    }
}
