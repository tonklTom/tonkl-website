"use client";

import { Wallet, Bot } from "lucide-react";
import { useScreenSize } from "@/hooks/use-screen-size";
import { PixelTrail } from "@/components/ui/pixel-trail";
import { GooeyFilter } from "@/components/ui/gooey-filter";

export default function WarpShaderHero({ onLaunchWallet }: { onLaunchWallet?: () => void }) {
  const screenSize = useScreenSize();
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#020202]">
      <nav className="absolute top-0 left-0 w-full px-6 py-8 md:px-12 flex items-center justify-between z-50 pointer-events-auto">
        <div className="flex items-center gap-3 select-none">
          <span className="text-2xl font-serif tracking-[0.05em] text-white/90 drop-shadow-md">Tonkl</span>
        </div>
        <button 
          onClick={() => window.location.hash = "#onboarding"}
          className="flex items-center gap-3 px-5 py-2.5 bg-cyan-500/10 backdrop-blur-md border border-cyan-500/30 hover:bg-cyan-500/20 hover:border-cyan-400/50 transition-all duration-300 rounded-full group shadow-[0_0_15px_rgba(6,182,212,0.15)]"
        >
          <Wallet className="w-4 h-4 text-cyan-400 group-hover:scale-110 transition-transform" />
          <span className="text-sm font-medium text-cyan-400">Create Wallet</span>
        </button>
      </nav>

      <div className="absolute inset-0 z-0 bg-black">
        <img 
          src="/dark_ethereal_bg.png" 
          alt="Tonkl Background"
          className="w-full h-full object-cover opacity-80" 
        />
      </div>

      <GooeyFilter id="gooey-filter-pixel-trail" strength={6} />
      <div
        className="absolute inset-0 z-[5]"
        style={{ filter: "url(#gooey-filter-pixel-trail)" }}
      >
        <PixelTrail
          pixelSize={screenSize.lessThan('md') ? 24 : 32}
          fadeDuration={0}
          delay={500}
          pixelClassName="bg-white rounded-sm"
        />
      </div>

      <div className="relative z-10 min-h-screen flex items-center justify-center px-8 bg-gradient-to-b from-black/10 via-transparent to-black/70 pointer-events-none">
        <div className="max-w-4xl w-full text-center space-y-8 pointer-events-auto">
          <h1 className="text-white text-5xl md:text-7xl font-sans font-light text-balance drop-shadow-2xl">
            Privacy Built in Shadows
          </h1>

          <p className="text-white/70 text-xl md:text-2xl font-sans font-light leading-relaxed max-w-3xl mx-auto drop-shadow-lg">
            Transact off the grid. Launch confidential tokens. Own your privacy.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-8">
            <button 
              onClick={onLaunchWallet}
              className="px-10 py-4 bg-cyan-500/10 backdrop-blur-md border border-cyan-500/30 rounded-full text-cyan-400 font-medium hover:bg-cyan-500/20 hover:border-cyan-400/50 transition-all duration-300 shadow-[0_0_20px_rgba(6,182,212,0.15)] hover:shadow-[0_0_30px_rgba(6,182,212,0.3)]"
            >
              Launch Wallet
            </button>
            <button 
              onClick={() => window.dispatchEvent(new CustomEvent('open-tonkl-ai'))}
              className="flex items-center gap-2 px-10 py-4 bg-white/5 backdrop-blur-sm border border-white/10 rounded-full text-white/80 font-medium hover:bg-white/10 hover:text-white transition-all duration-300"
            >
              Ask Tonkl AI
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
