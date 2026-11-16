import React from 'react';

import { IDeviceCleanupSettings } from '../../../../../shared/daemon-rpc-types';
import log from '../../../../../shared/logging';
import { useAppContext } from '../../../../context';
import { useQuery } from '../../../../lib/hooks';

export function useDeviceCleanupSettings() {
  const { getDeviceCleanupSettings, setDeviceCleanupSettings } = useAppContext();

  const { data } = useQuery<IDeviceCleanupSettings>({
    queryFn: getDeviceCleanupSettings,
    queryKey: ['device-cleanup-settings'],
  });

  // Local copy of the settings that takes precedence over the fetched settings once the user has
  // changed something, so that the UI updates immediately.
  const [updatedSettings, setUpdatedSettings] = React.useState<IDeviceCleanupSettings | undefined>(
    undefined,
  );
  const settings = updatedSettings ?? data;

  const updateSettings = React.useCallback(
    async (update: Partial<IDeviceCleanupSettings>) => {
      if (!settings) {
        return;
      }

      const nextSettings = { ...settings, ...update };
      setUpdatedSettings(nextSettings);

      try {
        await setDeviceCleanupSettings(nextSettings);
      } catch (error) {
        log.error('Failed to update automatic device cleanup settings', error);
        setUpdatedSettings(settings);
      }
    },
    [settings, setDeviceCleanupSettings],
  );

  const setEnabled = React.useCallback(
    (enabled: boolean) => updateSettings({ enabled }),
    [updateSettings],
  );

  const setIntervalSecs = React.useCallback(
    (intervalSecs: number) => updateSettings({ intervalSecs }),
    [updateSettings],
  );

  const setExcludedDeviceIds = React.useCallback(
    (excludedDeviceIds: Array<string>) => updateSettings({ excludedDeviceIds }),
    [updateSettings],
  );

  return { settings, setEnabled, setIntervalSecs, setExcludedDeviceIds };
}
