import { useEffect, useState } from "react";

/**
 * Становится true, только если `flag` держится true дольше `delayMs`, и
 * сразу сбрасывается, когда `flag` становится false. Пример: плашка «нет
 * соединения» не должна мигать на долю секунды при каждом открытии сокета,
 * но должна появиться, если связь пропала надолго.
 */
export function useDelayedFlag(flag: boolean, delayMs: number): boolean {
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    if (!flag) {
      setDelayed(false);
      return;
    }
    const t = setTimeout(() => setDelayed(true), delayMs);
    return () => clearTimeout(t);
  }, [flag, delayMs]);
  return delayed;
}
