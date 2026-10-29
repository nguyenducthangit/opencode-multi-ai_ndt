import type { ProbeQuotaResult } from "../../../core/adapter.js";
import { DEEPSEEK_BALANCE_URL } from "../constants.js";

export type DeepSeekBalanceResponse = {
  is_available?: boolean;
  balance_infos?: Array<{
    currency?: string;
    total_balance?: string;
    granted_balance?: string;
    topped_up_balance?: string;
  }>;
};

export async function probeDeepSeekBalance(
  apiKey: string,
): Promise<ProbeQuotaResult> {
  try {
    const res = await fetch(DEEPSEEK_BALANCE_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        reason: `HTTP ${res.status}: ${text.slice(0, 100)}`,
      };
    }

    const data = (await res.json()) as DeepSeekBalanceResponse;
    const info = Array.isArray(data.balance_infos) ? data.balance_infos[0] : undefined;

    const totalBalance =
      info?.total_balance !== undefined ? Number(info.total_balance) : undefined;
    const grantedBalance =
      info?.granted_balance !== undefined ? Number(info.granted_balance) : undefined;
    const toppedUpBalance =
      info?.topped_up_balance !== undefined
        ? Number(info.topped_up_balance)
        : undefined;

    return {
      ok: true,
      isAvailable: data.is_available,
      currency: info?.currency ?? "CNY",
      balance: totalBalance,
      totalBalance,
      grantedBalance,
      toppedUpBalance,
    };
  } catch (err) {
    return {
      ok: false,
      reason: (err as Error).message,
    };
  }
}
