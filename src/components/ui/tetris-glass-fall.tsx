"use client";
import React, { useMemo } from 'react';
import { motion } from 'framer-motion';

type Shape = number[][];
type Piece = {
  id: number;
  shape: Shape;
  left: number;
  delay: number;
  duration: number;
  scale: number;
  rotation: number;
};

// Tetris shapes represented by grids
const SHAPES: Shape[] = [
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

function seededValue(pieceIndex: number, salt: number): number {
  const value = Math.sin((pieceIndex + 1) * (salt + 17)) * 10000;
  return value - Math.floor(value);
}

export function TetrisGlassFall() {
  const pieces = useMemo<Piece[]>(() => {
    return Array.from({ length: 16 }).map((_, i) => {
      const shape = SHAPES[Math.floor(seededValue(i, 1) * SHAPES.length)];
      return {
        id: i,
        shape,
        left: 5 + seededValue(i, 2) * 90,
        delay: i < 4 ? 0 : seededValue(i, 3) * 8,
        duration: 15 + seededValue(i, 4) * 25,
        scale: 0.6 + seededValue(i, 5) * 1.5,
        rotation: Math.floor(seededValue(i, 6) * 4) * 90,
      };
    });
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
