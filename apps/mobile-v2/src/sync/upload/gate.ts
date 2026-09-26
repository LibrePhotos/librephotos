/**
 * Upload gating policy (doc 03 §5). Decides whether the worker may run given the
 * user's wifi-only / charging-only settings and the current device state. Pure:
 * the live network/battery reads come from an injected {@link DeviceProbe}
 * (backed by expo-network + expo-battery in the app), so the policy is
 * Node-tested with a fake probe.
 */

export type DeviceState = {
  /** True when connected to an unmetered network (wifi/ethernet). */
  onWifi: boolean;
  /** True when connected to any network at all. */
  online: boolean;
  /** True when charging or full. */
  charging: boolean;
};

export interface DeviceProbe {
  read(): Promise<DeviceState>;
}

export type BackupGates = {
  wifiOnly: boolean;
  chargingOnly: boolean;
};

export type GateDecision = { allowed: true } | { allowed: false; reason: string };

export interface UploadGate {
  check(): Promise<GateDecision>;
}

/** Evaluate the gate settings against a device state (pure). */
export function evaluateGate(gates: BackupGates, state: DeviceState): GateDecision {
  if (!state.online) return { allowed: false, reason: "offline" };
  if (gates.wifiOnly && !state.onWifi) return { allowed: false, reason: "wifi_required" };
  if (gates.chargingOnly && !state.charging) return { allowed: false, reason: "charging_required" };
  return { allowed: true };
}

/** Build an UploadGate from settings + a device probe. */
export function makeUploadGate(gates: BackupGates, probe: DeviceProbe): UploadGate {
  return {
    async check() {
      const state = await probe.read();
      return evaluateGate(gates, state);
    },
  };
}
