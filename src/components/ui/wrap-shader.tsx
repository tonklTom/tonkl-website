"use client";
import { useEffect } from "react";
import { Wallet, Bot } from "lucide-react";
import { useScreenSize } from "@/hooks/use-screen-size";
import { PixelTrail } from "@/components/ui/pixel-trail";
import { GooeyFilter } from "@/components/ui/gooey-filter";
import { TonklAIChatOverlay } from "@/components/ui/tonkl-ai-chat-overlay";
import { TetrisGlassFall } from "@/components/ui/tetris-glass-fall";

export default function WarpShaderHero({ onLaunchWallet }: { onLaunchWallet?: () => void }) {
  const screenSize = useScreenSize();

  useEffect(() => {
    // Force scroll to top when mounting the landing page
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  return (
    <main className="relative bg-[#020202]">
      <nav className="absolute top-0 left-0 w-full px-6 py-8 md:px-12 flex items-center justify-between z-50 pointer-events-auto">
        <div className="flex items-center gap-3 select-none">
          <span className="text-2xl font-serif tracking-[0.05em] text-white/90 drop-shadow-md">Tonkl</span>
        </div>
        <button
          onClick={() => window.location.hash = "#onboarding"}
          className="flex items-center gap-3 px-5 py-2.5 bg-white/5 backdrop-blur-sm border border-white/10 rounded-full text-white/80 font-medium hover:bg-white/10 hover:text-white transition-all duration-300 group"
        >
          <span className="text-lg font-serif font-light group-hover:scale-110 transition-transform">Λ</span>
          <span className="text-sm">Create</span>
        </button>
      </nav>

      <div className="sticky top-0 w-full h-screen overflow-hidden z-0">
        <div className="absolute inset-0 z-0 bg-black">
          <img
            src="/david_statue_bg.png"
            alt="Tonkl Background - David Statue"
            className="w-full h-full object-cover opacity-80"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/70 pointer-events-none" />
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
      </div>

      <div className="relative z-10 -mt-[100vh] pointer-events-none">
        <div className="relative h-screen flex items-center justify-center px-8 pointer-events-none overflow-hidden">

        {/* Falling glass Tetris pieces overlay (now in front of text) */}
        <div className="absolute inset-0 z-50 pointer-events-none">
          <TetrisGlassFall />
        </div>

        <div className="relative z-10 max-w-4xl w-full text-center space-y-8 pointer-events-auto">
          <h1 className="text-white text-5xl md:text-7xl font-sans font-light text-balance drop-shadow-2xl">
            Privacy Built in Shadows
          </h1>

          <p className="text-white/70 text-xl md:text-2xl font-sans font-light leading-relaxed max-w-3xl mx-auto drop-shadow-lg">
            Transact off the grid. Launch confidential tokens. Own your privacy.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-8">
            <button
              onClick={onLaunchWallet}
              className="px-10 py-4 bg-white/5 backdrop-blur-sm border border-white/10 rounded-full text-white/80 font-medium hover:bg-white/10 hover:text-white transition-all duration-300"
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

        {/* Chat Section */}
        <div id="tonkl-ai-chat-section" className="min-h-screen bg-black/40 backdrop-blur-3xl border-t border-white/10 flex flex-col items-center shadow-[0_-20px_50px_rgba(0,0,0,0.8)] relative z-20 pointer-events-auto overflow-hidden">
           <div className="w-full max-w-5xl h-[100vh] pt-24 pb-12 px-4 flex flex-col">
             <TonklAIChatOverlay embedded={true} />
           </div>
        </div>
      </div>
    </main>
  );
}
