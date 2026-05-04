"use client";

import { cn } from "@/lib/utils";
import React from "react";

// --- SiriOrb Component ---
interface SiriOrbProps {
  size?: string;
  className?: string;
  colors?: {
    bg?: string;
    c1?: string;
    c2?: string;
    c3?: string;
  };
  isSpeaking?: boolean;
}

const SiriOrb: React.FC<SiriOrbProps> = ({
  size = "256px",
  className,
  colors,
  isSpeaking = false,
}) => {
  // Obsidian / Gunmetal iridescent aesthetic
  const defaultColors = {
    bg: "#080808",             // Solid dark opaque background
    c1: "oklch(65% 0.05 250)", // Metallic bluish-silver
    c2: "oklch(20% 0.05 300)", // Deep obsidian purple-black
    c3: "oklch(40% 0.02 200)", // Gunmetal grey
  };

  const finalColors = { ...defaultColors, ...colors };
  const sizeValue = parseInt(size.replace("px", ""), 10);

  // If speaking, drastically increase blur and contrast to "melt" the edges, and speed up animation
  const blurAmount = isSpeaking ? Math.max(sizeValue * 0.15, 15) : Math.max(sizeValue * 0.08, 8);
  const contrastAmount = isSpeaking ? Math.max(sizeValue * 0.005, 3.0) : Math.max(sizeValue * 0.003, 1.8);
  const animationDuration = isSpeaking ? 5 : 20;

  return (
    <div
      className={cn("siri-orb", className)}
      style={
        {
          width: size,
          height: size,
          "--bg": finalColors.bg,
          "--c1": finalColors.c1,
          "--c2": finalColors.c2,
          "--c3": finalColors.c3,
          "--animation-duration": `${animationDuration}s`,
          "--blur-amount": `${blurAmount}px`,
          "--contrast-amount": contrastAmount,
        } as React.CSSProperties
      }
    >
      <style jsx>{`
        @property --angle {
          syntax: "<angle>";
          inherits: false;
          initial-value: 0deg;
        }

        .siri-orb {
          display: grid;
          grid-template-areas: "stack";
          overflow: hidden;
          border-radius: 50%;
          position: relative;
          background: var(--bg);
          box-shadow: inset 0 0 60px rgba(0,0,0,0.9), 0 0 40px rgba(255,255,255,0.05);
        }

        .siri-orb::before {
          content: "";
          display: block;
          grid-area: stack;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          background:
            conic-gradient(
              from calc(var(--angle) * 1.2) at 30% 65%,
              var(--c3) 0deg,
              transparent 45deg 315deg,
              var(--c3) 360deg
            ),
            conic-gradient(
              from calc(var(--angle) * 0.8) at 70% 35%,
              var(--c2) 0deg,
              transparent 60deg 300deg,
              var(--c2) 360deg
            ),
            conic-gradient(
              from calc(var(--angle) * -1.5) at 65% 75%,
              var(--c1) 0deg,
              transparent 90deg 270deg,
              var(--c1) 360deg
            ),
            conic-gradient(
              from calc(var(--angle) * 2.1) at 25% 25%,
              var(--c2) 0deg,
              transparent 30deg 330deg,
              var(--c2) 360deg
            ),
            conic-gradient(
              from calc(var(--angle) * -0.7) at 80% 80%,
              var(--c1) 0deg,
              transparent 45deg 315deg,
              var(--c1) 360deg
            ),
            radial-gradient(
              ellipse 120% 80% at 40% 60%,
              var(--c3) 0%,
              transparent 50%
            );
          filter: blur(var(--blur-amount)) contrast(var(--contrast-amount)) saturate(1.2);
          animation: rotate var(--animation-duration) linear infinite;
          transform: translateZ(0);
          will-change: transform, filter;
          transition: filter 0.5s ease-in-out;
        }

        .siri-orb::after {
          content: "";
          display: block;
          grid-area: stack;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          background: radial-gradient(
            circle at 45% 55%,
            rgba(255, 255, 255, 0.1) 0%,
            rgba(255, 255, 255, 0.05) 30%,
            transparent 60%
          );
          mix-blend-mode: overlay;
        }

        @keyframes rotate {
          from {
            --angle: 0deg;
          }
          to {
            --angle: 360deg;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .siri-orb::before {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
};

export default SiriOrb;
