import { useEffect, useState } from "react";

/** Whether the device has a mouse (hover cards) rather than touch (bottom sheets). */
export function useCanHover(): boolean {
  const [canHover, setCanHover] = useState(() => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  useEffect(() => {
    const query = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setCanHover(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return canHover;
}
