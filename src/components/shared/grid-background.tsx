"use client";

import GridDistortion from "@/components/GridDistortion";

export function GridBackground({ className = "" }: { className?: string }) {
  return (
    <GridDistortion
      imageSrc="/flower-edited.jpg"
      grid={18}
      radius={0.22}
      strength={0.12}
      relaxation={0.965}
      mode="swirl"
      softness={0.18}
      chroma={0.35}
      idle={0.16}
      className={className}
    />
  );
}
