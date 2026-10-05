/**
 * A full-page picture behind the landing page that changes every hour (on the hour), fading from one to the next.
 * Kept quiet: dimmed, blurred a little and fading into the page colour, so the content stays in front.
 */
import { useEffect, useState } from "react";
import { HOME_BACKGROUNDS, homeBackgroundAt } from "@/lib/art";

export function HourlyBackdrop() {
  const [now, setNow] = useState(() => new Date());
  const [failed, setFailed] = useState<string[]>([]);
  useEffect(() => {
    // wake at the next full hour, then every hour
    const untilHour = 3_600_000 - (Date.now() % 3_600_000) + 500;
    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 3_600_000);
    }, untilHour);
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, []);
  // the next hour's picture is loaded early so the change is a fade, not a flash
  useEffect(() => {
    const next = new Image();
    next.src = homeBackgroundAt(new Date(now.getTime() + 3_600_000));
  }, [now]);
  const current = homeBackgroundAt(now);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-[5] overflow-hidden">
      {HOME_BACKGROUNDS.filter((src) => !failed.includes(src)).map((src) => (
        <img
          key={src}
          src={src}
          alt=""
          decoding="async"
          onError={() => setFailed((f) => [...f, src])}
          className={`absolute inset-0 h-full w-full scale-105 object-cover blur-[1px] transition-opacity duration-[2500ms] ease-in-out motion-reduce:transition-none ${src === current ? "opacity-30 dark:opacity-40" : "opacity-0"}`}
        />
      ))}
      <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/40 to-background" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,var(--background)_100%)] opacity-70" />
    </div>
  );
}
