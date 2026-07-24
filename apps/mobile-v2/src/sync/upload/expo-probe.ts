/**
 * Real {@link DeviceProbe} for the upload gate: current network + charging
 * state via expo-network + expo-battery. App-only: imported solely by sync/run.
 */
import { getNetworkStateAsync, NetworkStateType } from "expo-network";
import { getBatteryStateAsync, BatteryState } from "expo-battery";
import type { DeviceProbe, DeviceState } from "./gate";

const UNMETERED = new Set<NetworkStateType>([
  NetworkStateType.WIFI,
  NetworkStateType.ETHERNET,
]);

export function createExpoDeviceProbe(): DeviceProbe {
  return {
    async read(): Promise<DeviceState> {
      const [net, battery] = await Promise.all([
        getNetworkStateAsync().catch(() => ({}) as { type?: NetworkStateType; isConnected?: boolean }),
        getBatteryStateAsync().catch(() => BatteryState.UNKNOWN),
      ]);
      const onWifi = net.type != null && UNMETERED.has(net.type);
      return {
        onWifi,
        online: net.isConnected === true,
        charging: battery === BatteryState.CHARGING || battery === BatteryState.FULL,
      };
    },
  };
}
