import RNBluetoothClassic, { BluetoothDevice } from 'react-native-bluetooth-classic';

let activeDevice: BluetoothDevice | null = null;

export async function sendEspEmotion(
  espIp: string,
  state: string,
  conn: string = 'BT_OK',
  move: string = 'S'
) {
  if (!espIp) return;
  const cleanIp = espIp.replace(/^http:\/\//, '').trim();
  const url = `http://${cleanIp}/emotion?state=${encodeURIComponent(state)}&conn=${encodeURIComponent(conn)}&move=${encodeURIComponent(move)}`;
  try {
    await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  } catch (e) {
    console.log('ESP8266 update error:', e);
  }
}

export async function connectHc05(addressOrName: string): Promise<boolean> {
  try {
    const bonded = await RNBluetoothClassic.getBondedDevices();
    const device = bonded.find(
      (d) =>
        d.address === addressOrName ||
        d.name === addressOrName ||
        d.name?.includes('HC-05')
    );
    if (!device) return false;

    const connected = await device.isConnected();
    if (connected) {
      activeDevice = device;
      return true;
    }

    const success = await device.connect();
    if (success) activeDevice = device;
    return success;
  } catch (e) {
    console.log('HC-05 connect error:', e);
    return false;
  }
}

export async function sendRobotCommand(cmd: string) {
  if (!activeDevice) return;
  try {
    await activeDevice.write(cmd);
  } catch (e) {
    console.log('HC-05 write error:', e);
  }
}
