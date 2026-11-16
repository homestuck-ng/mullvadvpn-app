import React, { useCallback, useEffect, useId } from 'react';
import { sprintf } from 'sprintf-js';

import { IDevice, IDeviceCleanupSettings } from '../../../../../../shared/daemon-rpc-types';
import { messages } from '../../../../../../shared/gettext';
import { removeNonNumericCharacters } from '../../../../../../shared/string-helpers';
import { FlexColumn } from '../../../../../lib/components/flex-column';
import type { ListItemPositions } from '../../../../../lib/components/list-item';
import { Switch } from '../../../../../lib/components/switch';
import { useTextField } from '../../../../../lib/components/text-field';
import { formatDeviceName } from '../../../../../lib/utils';
import { SettingsListItem } from '../../../../settings-list-item';
import { SettingsListbox } from '../../../../settings-listbox';

const MIN_KICK_COOLDOWN_SECS = 1;
const MAX_KICK_COOLDOWN_SECS = 3600;

function kickCooldownIsValid(value: string): boolean {
  if (value === '') {
    return false;
  }
  const parsed = Number.parseInt(value, 10);
  return (
    Number.isFinite(parsed) &&
    parsed >= MIN_KICK_COOLDOWN_SECS &&
    parsed <= MAX_KICK_COOLDOWN_SECS
  );
}

function firstOptionPosition(index: number, count: number): ListItemPositions | undefined {
  if (index !== 0) {
    return undefined;
  }

  return count === 1 ? 'last' : 'middle';
}

export type DeviceCleanupPanelProps = {
  settings: IDeviceCleanupSettings;
  devices: Array<IDevice>;
  currentDeviceName?: string;
  onEnabledChange: (enabled: boolean) => void;
  onIntervalChange: (intervalSecs: number) => void;
  onExcludedDeviceIdsChange: (excludedDeviceIds: Array<string>) => void;
};

export function DeviceCleanupPanel({
  settings,
  devices,
  currentDeviceName,
  onEnabledChange,
  onIntervalChange,
  onExcludedDeviceIdsChange,
}: DeviceCleanupPanelProps) {
  const descriptionId = useId();
  const cooldownLabelId = useId();
  const cooldownDescriptionId = useId();
  const inputRef = React.useRef<HTMLInputElement>(null);

  const { enabled, intervalSecs, excludedDeviceIds } = settings;
  const clampedIntervalSecs = Math.min(
    MAX_KICK_COOLDOWN_SECS,
    Math.max(MIN_KICK_COOLDOWN_SECS, intervalSecs),
  );

  const removableDevices = devices.filter((device) => device.name !== currentDeviceName);

  const { value, handleOnValueChange, invalid, dirty, blur, reset } = useTextField({
    inputRef,
    defaultValue: clampedIntervalSecs.toString(),
    format: removeNonNumericCharacters,
    validate: kickCooldownIsValid,
  });

  useEffect(() => {
    reset(clampedIntervalSecs.toString());
  }, [clampedIntervalSecs, reset]);

  useEffect(() => {
    if (intervalSecs !== clampedIntervalSecs) {
      onIntervalChange(clampedIntervalSecs);
    }
  }, [clampedIntervalSecs, intervalSecs, onIntervalChange]);

  const commitCooldown = useCallback(
    async (nextValue: string) => {
      if (!kickCooldownIsValid(nextValue)) {
        return;
      }
      const parsed = Number.parseInt(nextValue, 10);
      if (parsed !== intervalSecs) {
        onIntervalChange(parsed);
      }
    },
    [intervalSecs, onIntervalChange],
  );

  const handleBlur = useCallback(async () => {
    if (!invalid && dirty) {
      await commitCooldown(value);
    }
    if (invalid) {
      reset();
    }
  }, [commitCooldown, dirty, invalid, reset, value]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!invalid) {
        await commitCooldown(value);
        blur();
      }
    },
    [blur, commitCooldown, invalid, value],
  );

  return (
    <FlexColumn gap="medium">
      <SettingsListItem>
        <SettingsListItem.Item>
          <Switch checked={enabled} onCheckedChange={onEnabledChange} descriptionId={descriptionId}>
            <Switch.Label>
              {
                // TRANSLATORS: Label for the toggle that enables automatic removal of other devices.
                messages.pgettext('device-management', 'Remove other devices automatically')
              }
            </Switch.Label>
            <SettingsListItem.Item.ActionGroup>
              <Switch.Input />
            </SettingsListItem.Item.ActionGroup>
          </Switch>
        </SettingsListItem.Item>
        <SettingsListItem.Footer>
          <SettingsListItem.Footer.Text id={descriptionId}>
            {
              // TRANSLATORS: Description of the automatic device cleanup feature.
              messages.pgettext(
                'device-management',
                'When enabled, other devices on this account are removed after each kick cooldown. Your current device and excluded devices stay.',
              )
            }
          </SettingsListItem.Footer.Text>
        </SettingsListItem.Footer>
      </SettingsListItem>

      <SettingsListItem aria-labelledby={cooldownLabelId}>
        <SettingsListItem.Item>
          <SettingsListItem.Item.Label id={cooldownLabelId}>
            {
              // TRANSLATORS: Label for the kick cooldown input field.
              messages.pgettext('device-management', 'Kick cooldown (seconds)')
            }
          </SettingsListItem.Item.Label>
          <SettingsListItem.Item.ActionGroup>
            <SettingsListItem.Item.TextField
              value={value}
              onValueChange={handleOnValueChange}
              onSubmit={handleSubmit}
              invalid={invalid}>
              <SettingsListItem.Item.TextField.Input
                ref={inputRef}
                placeholder="1"
                width="small"
                inputMode="numeric"
                maxLength={4}
                aria-labelledby={cooldownLabelId}
                aria-describedby={cooldownDescriptionId}
                onBlur={handleBlur}
              />
            </SettingsListItem.Item.TextField>
          </SettingsListItem.Item.ActionGroup>
        </SettingsListItem.Item>
        <SettingsListItem.Footer>
          <SettingsListItem.Footer.Text id={cooldownDescriptionId}>
            {sprintf(
              // TRANSLATORS: Hint under the kick cooldown field.
              // TRANSLATORS: Available placeholders:
              // TRANSLATORS: %(min)d - minimum cooldown in seconds
              // TRANSLATORS: %(max)d - maximum cooldown in seconds
              messages.pgettext(
                'device-management',
                'Seconds between checks. Range: %(min)d–%(max)d.',
              ),
              {
                min: MIN_KICK_COOLDOWN_SECS,
                max: MAX_KICK_COOLDOWN_SECS,
              },
            )}
          </SettingsListItem.Footer.Text>
        </SettingsListItem.Footer>
      </SettingsListItem>

      {removableDevices.length > 0 && (
        <SettingsListbox value={excludedDeviceIds} onValueChange={onExcludedDeviceIdsChange}>
          <SettingsListbox.Header>
            <SettingsListbox.Header.Item>
              <SettingsListbox.Header.Item.Label>
                {
                  // TRANSLATORS: Label for the list of devices that automatic device cleanup must
                  // TRANSLATORS: not remove.
                  messages.pgettext('device-management', 'Never remove these devices')
                }
              </SettingsListbox.Header.Item.Label>
            </SettingsListbox.Header.Item>
          </SettingsListbox.Header>
          <SettingsListbox.Options>
            {removableDevices.map((device, index) => (
              <SettingsListbox.Options.CheckboxOption
                key={device.id}
                value={device.id}
                checked={excludedDeviceIds.includes(device.id)}
                position={firstOptionPosition(index, removableDevices.length)}>
                {formatDeviceName(device.name)}
              </SettingsListbox.Options.CheckboxOption>
            ))}
          </SettingsListbox.Options>
          <SettingsListbox.Footer>
            <SettingsListbox.Footer.Text>
              {
                // TRANSLATORS: Explanation for the list of devices excluded from automatic
                // TRANSLATORS: device cleanup.
                messages.pgettext('device-management', 'Your current device is always kept.')
              }
            </SettingsListbox.Footer.Text>
          </SettingsListbox.Footer>
        </SettingsListbox>
      )}
    </FlexColumn>
  );
}
