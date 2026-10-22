// Stand-in for shell/core/ipc.ts. The picker's only call is clipboard.copy (CopyAs): it goes to the bridge.
import { bridge } from '../bridge.ts';

export const ipc = {
  async invoke(channel: string, arg: { kind?: string; data?: string }): Promise<void> {
    if (channel === 'clipboard.copy' && typeof arg?.data === 'string') return bridge.copy(arg.data);
    throw new Error(`no such call: ${channel}`);
  },
};
