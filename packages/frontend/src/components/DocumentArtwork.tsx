import type { PointerEvent } from "react";
import { motion, useReducedMotion, useSpring } from "framer-motion";

export function DocumentArtwork() {
  const reduced = useReducedMotion();
  const rotateX = useSpring(0, { stiffness: 130, damping: 24 });
  const rotateY = useSpring(0, { stiffness: 130, damping: 24 });
  function handlePointer(event: PointerEvent<HTMLDivElement>) {
    if (reduced || event.pointerType !== "mouse") return;
    const box = event.currentTarget.getBoundingClientRect();
    rotateX.set(((event.clientY - box.top) / box.height - 0.5) * -8);
    rotateY.set(((event.clientX - box.left) / box.width - 0.5) * 10);
  }
  return (
    <div
      className="artwork-perspective"
      onPointerMove={handlePointer}
      onPointerLeave={() => {
        rotateX.set(0);
        rotateY.set(0);
      }}
    >
      <motion.div
        className="document-artwork"
        style={reduced ? undefined : { rotateX, rotateY }}
      >
        <img
          src="/images/document-sculpture.webp"
          srcSet="/images/document-sculpture-640.webp 640w, /images/document-sculpture-1024.webp 1024w, /images/document-sculpture.webp 1536w"
          sizes="(max-width: 767px) calc(100vw - 40px), (max-width: 1279px) 48vw, 574px"
          alt="Объёмная композиция из листов бумаги, скрепки и бордовой печати с галочкой"
          width="1536"
          height="1024"
          fetchPriority="high"
        />
      </motion.div>
    </div>
  );
}
