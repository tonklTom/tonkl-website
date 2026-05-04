"use client";

import { motion, AnimatePresence, LayoutGroup } from "motion/react";
import React, { useState, useId } from "react";
import Image from "next/image";
import { Wallet, Coins, Bot, FileText, LifeBuoy, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";

const CARDS = [
  {
    id: "card-1",
    title: "Wallet",
    icon: Wallet,
    rotation: -12,
    x: -200,
    y: 15,
    image: "/wallet.png"
  },
  {
    id: "card-2",
    title: "Tokens",
    icon: Coins,
    rotation: -7,
    x: -120,
    y: 5,
    image: "https://images.unsplash.com/photo-1621504450181-5d356f61d307?w=900&auto=format&fit=crop&q=60"
  },
  {
    id: "card-3",
    title: "Shlem Ai",
    icon: Bot,
    rotation: -2,
    x: -40,
    y: -5,
    image: "/shlem-ai.jpg"
  },
  {
    id: "card-4",
    title: "Docs",
    icon: FileText,
    rotation: 2,
    x: 40,
    y: -5,
    image: "https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?w=900&auto=format&fit=crop&q=60"
  },
  {
    id: "card-5",
    title: "Support",
    icon: LifeBuoy,
    rotation: 7,
    x: 120,
    y: 5,
    image: "https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=900&auto=format&fit=crop&q=60"
  },
  {
    id: "card-6",
    title: "Socials",
    icon: Share2,
    rotation: 12,
    x: 200,
    y: 15,
    image: "https://images.unsplash.com/photo-1620321023374-d1a68fbc720d?w=900&auto=format&fit=crop&q=60"
  }
];

const transition = {
  type: "tween",
  ease: "easeInOut",
  duration: 0.8,
} as const;

export function ExpandableGallery({ onCardClick }: { onCardClick?: (id: string) => void }) {
  const [isHovered, setIsHovered] = useState(false);
  const layoutGroupId = useId();

  return (
    <section className="relative w-full px-4 md:px-8 bg-black text-white flex flex-col items-center justify-center min-h-[850px] overflow-hidden pt-20">
      <header className="fixed top-0 left-0 w-full px-6 py-8 md:px-12 flex items-center justify-between z-50 bg-gradient-to-b from-black/80 to-transparent">
        <div className="flex items-center gap-3 select-none">
          <span className="text-2xl font-serif tracking-[0.05em] text-white/90">Tonkl</span>
        </div>
        <div className="flex items-center gap-4">
          {/* Future header buttons will be placed here */}
        </div>
      </header>

      <LayoutGroup id={layoutGroupId}>
        <div className="w-full max-w-6xl mx-auto flex flex-col items-center">
          
          <AnimatePresence>
            <motion.div
              key="stack-content"
              layout
              className="text-center max-w-2xl mb-16 relative"
            >
              

              <div className="relative inline-block group rounded-2xl overflow-hidden cursor-crosshair">
                <p className="text-white/60 text-lg px-8 py-6 relative z-0 transition-opacity duration-1000 group-hover:opacity-100">
                  Tonkl is a privacy L1 blockchain. Send money privately, create tokens with private info, and explore our native privacy ecosystem.
                </p>
                {/* Frosted Glass Privacy Overlay */}
                <div className="absolute inset-0 backdrop-blur-[10px] bg-black/60 group-hover:backdrop-blur-none group-hover:bg-transparent transition-all duration-1000 z-10 pointer-events-none border border-white/10 group-hover:border-transparent flex items-center justify-center">
                  <span className="text-white/30 text-xs tracking-widest uppercase transition-opacity duration-1000 group-hover:opacity-0">Restricted</span>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>

          <motion.div
            layout
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className={cn(
              "relative w-full max-w-5xl cursor-pointer",
              isHovered
                ? "grid grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8 p-4 md:p-10"
                : "flex flex-col items-center justify-start h-[450px]"
            )}
            transition={transition}
          >
            <div
              className={cn(
                "relative",
                isHovered
                  ? "contents"
                  : "w-full flex items-center justify-center pt-24"
              )}
            >
              {CARDS.map((card, index) => {
                const Icon = card.icon;
                return (
                  <motion.div
                    key={`card-${card.id}`}
                    layoutId={`card-container-${card.id}`}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{
                      opacity: 1,
                      scale: 1,
                      rotate: !isHovered ? card.rotation : 0,
                      x: !isHovered ? card.x : 0,
                      y: !isHovered ? card.y : 0,
                      zIndex: !isHovered ? 10 + index : 10,
                    }}
                    transition={transition}
                    className={cn(
                      "cursor-pointer overflow-hidden bg-black/50 group",
                      isHovered
                        ? "relative aspect-square rounded-[2rem] border-[4px] border-black shadow-[0_0_40px_rgba(255,255,255,0.05)] hover:border-white/20 transition-colors duration-500"
                        : "absolute w-44 h-44 md:w-56 md:h-56 rounded-[2.5rem] border-[6px] border-black shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
                    )}
                    onClick={() => {
                      if (!isHovered) {
                        setIsHovered(true);
                      } else if (onCardClick) {
                        onCardClick(card.id);
                      }
                    }}
                  >
                    <motion.div
                      layoutId={`image-inner-${card.id}`}
                      layout="position"
                      className="w-full h-full relative"
                      transition={transition}
                    >
                      <Image
                        src={card.image}
                        alt={card.title}
                        fill
                        className={cn(
                          "object-cover transition-all duration-1000 select-none pointer-events-none",
                          isHovered ? "opacity-30 group-hover:opacity-50 scale-105 group-hover:scale-110" : "opacity-100"
                        )}
                        sizes="(max-width: 1024px) 50vw, 33vw"
                        priority
                      />
                      <div className={cn(
                          "absolute inset-0 flex flex-col items-center justify-center p-6 text-center transition-opacity duration-1000",
                          isHovered ? "opacity-100" : "opacity-0 pointer-events-none"
                      )}>
                         <Icon className="w-14 h-14 mb-6 text-white drop-shadow-lg transition-transform duration-1000 group-hover:-translate-y-2" />
                         <span className="text-2xl font-medium tracking-wide text-white drop-shadow-md">
                           {card.title}
                         </span>
                      </div>
                    </motion.div>
                  </motion.div>
                );
              })}
            </div>
            
            {/* Overlay hint text when not hovered */}
            {!isHovered && (
               <div className="absolute bottom-10 left-1/2 -translate-x-1/2 text-white/40 text-sm tracking-widest uppercase pointer-events-none animate-pulse">
                  Hover to explore
               </div>
            )}
          </motion.div>

        </div>
      </LayoutGroup>
    </section>
  );
}

export default ExpandableGallery;
