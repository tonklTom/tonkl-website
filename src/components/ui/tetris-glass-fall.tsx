"use client";
import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

// Tetris shapes represented by grids
const SHAPES = [
  // Square
  [[1,1], [1,1]],
  // Line
  [[1,1,1,1]],
  // T-Shape
  [[1,1,1], [0,1,0]],
  // L-Shape
  [[1,0], [1,0], [1,1]],
  // S-Shape
  [[0,1,1], [1,1,0]]
];

export function TetrisGlassFall() {
  const [pieces, setPieces] = useState<any[]>([]);

  useEffect(() => {
    // Generate random pieces
    const generated = Array.from({ length: 12 }).map((_, i) => {
      const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
      return {
        id: i,
        shape,
        left: 5 + Math.random() * 90, // random start horizontal position (vw)
        delay: Math.random() * 20, // random delay up to 20s
        duration: 15 + Math.random() * 25, // slow fall duration between 15s and 40s
        scale: 0.6 + Math.random() * 1.5, // random size scale
        rotation: Math.floor(Math.random() * 4) * 90, // rotate by 90 deg increments
      };
    });
    setPieces(generated);
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
      {pieces.map((piece) => (
        <motion.div
          key={piece.id}
          initial={{ y: "-20vh", left: `${piece.left}%`, rotate: piece.rotation }}
          animate={{ y: "120vh" }}
          transition={{
            duration: piece.duration,
            repeat: Infinity,
            delay: piece.delay,
            ease: "linear",
          }}
          className="absolute top-0 flex flex-col gap-0"
          style={{ transform: `scale(${piece.scale})` }}
        >
          {piece.shape.map((row: number[], rIdx: number) => (
            <div key={rIdx} className="flex gap-0">
              {row.map((cell: number, cIdx: number) => (
                <div 
                  key={cIdx} 
                  className={`w-8 h-8 ${
                    cell 
                      ? "bg-black/10 backdrop-blur-2xl" 
                      : "bg-transparent"
                  }`} 
                />
              ))}
            </div>
          ))}
        </motion.div>
      ))}
    </div>
  );
}
