import { useState } from "react";
import { IconUsers } from "./icons";

// Пары цветов для градиента. Подобраны так, чтобы белые инициалы читались
// и в светлой, и в тёмной теме.
const PALETTE: Array<[string, string]> = [
  ["#ff885e", "#ff516a"],
  ["#f5b04c", "#e8833a"],
  ["#82b1ff", "#665fff"],
  ["#6fcf8e", "#2fa366"],
  ["#3ccfc0", "#1fa39a"],
  ["#72d5fd", "#2a9ef1"],
  ["#e0a2f3", "#d669ed"],
  ["#c79bf2", "#9a63e6"],
];

/** Стабильная пара цветов по id: один и тот же человек всегда одного цвета. */
function colorsFor(seed: string): [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  // `!`: индекс по модулю длины всегда в границах массива.
  return PALETTE[Math.abs(h) % PALETTE.length]!;
}

/**
 * Цвет имени автора в групповом чате — тот же оттенок, что у его аватара,
 * чтобы в длинной переписке глаз связывал имя и кружок.
 */
export function nameColor(seed: string): string {
  return colorsFor(seed)[1];
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0] ?? "");
  return letters.join("").toUpperCase() || "?";
}

/**
 * Разрешаем только http(s). avatar_url приходит из профиля, который
 * пользователь может заполнить сам, — `javascript:`/`data:` в src картинки
 * пускать незачем.
 */
function safeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

export function Avatar({
  name,
  seed,
  size = 40,
  url,
  group = false,
}: {
  /** Имя — для инициалов. */
  name: string;
  /** Что определяет цвет (обычно id пользователя или чата). */
  seed: string;
  size?: number;
  url?: string | null;
  /** Группа без названия — вместо инициалов значок «люди». */
  group?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : safeImageUrl(url);
  const [from, to] = colorsFor(seed);

  return (
    // Аватар декоративный: имя всегда написано рядом текстом.
    <span
      className="avatar"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        backgroundImage: `linear-gradient(135deg, ${from}, ${to})`,
      }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          // Не сообщаем стороннему хостингу картинок, из какого чата её смотрят.
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : group ? (
        <IconUsers size={Math.round(size * 0.5)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}
