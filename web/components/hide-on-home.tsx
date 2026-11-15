"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Renders ``children`` everywhere except the home page (its 3D room is full screen). */
export function HideOnHome({ children }: { children: ReactNode }) {
  return usePathname() === "/" ? null : children;
}
