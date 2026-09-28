import { useEffect, useState } from "react";

/**
 * Становится true, только если `flag` держится true дольше `delayMs`, и
 * сразу сбрасывается, когда `flag` становится false. Пример: плашка «нет
 * соединения» не должна мигать на долю секунды при каждом открытии сокета,
 * но должна появиться, если связь пропала надолго.
 */
export function useDelayedFlag(flag: boolean, delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);

  // Сброс — во время рендера, а не в эффекте: так React не рисует лишний
  // кадр со старым значением (паттерн «подстройка состояния при смене пропса»).
  if (!flag && elapsed) setElapsed(false);

  useEffect(() => {
    if (!flag) return;
    const t = setTimeout(() => setElapsed(true), delayMs);
    return () => clearTimeout(t);
  }, [flag, delayMs]);

  return flag && elapsed;
}
