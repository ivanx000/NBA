"use client";

import dynamic from "next/dynamic";

const AllJerseysScene = dynamic(() => import("./all-jerseys-scene"), { ssr: false });

export function AllJerseys() {
  return (
    <main id="main" className="relative h-svh">
      <AllJerseysScene />
    </main>
  );
}
