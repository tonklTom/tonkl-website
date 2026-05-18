import React, { useState } from "react";
import { X, ArrowRight, ExternalLink, CalendarDays, Share2, Eye, MessageSquare, Heart } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Warp } from "@paper-design/shaders-react";
import * as Avatar from "@radix-ui/react-avatar";

const BASE_MOCK_NEWS = [
  {
    id: 1,
    author: "Tonkl Core",
    handle: "@tonklnetwork",
    avatar: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=200&auto=format&fit=crop",
    title: "Tonkl V2 Protocol Upgrade is Live",
    summary: "The highly anticipated V2 upgrade introduces sub-second shielded transactions.",
    content: "We are thrilled to announce that Tonkl V2 has officially hit mainnet. This upgrade completely overhauls our zero-knowledge proof generation pipeline, dropping shielded transaction times from 3 seconds down to 400ms. All node operators must update their clients by Friday to avoid falling out of consensus.",
    image: "https://images.unsplash.com/photo-1639762681485-074b7f4ec651?q=80&w=1200&auto=format&fit=crop",
    date: "2 hours ago",
    link: "https://tonkl.network/v2-upgrade",
    views: "24.5k",
    comments: 892,
    likes: "5.2k",
    span: "col-span-2 row-span-2"
  },
  {
    id: 2,
    author: "Emotex Labs",
    handle: "@emotex_labs",
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&fit=crop",
    title: "Launching our new Privacy DEX",
    summary: "Trade completely anonymously with deep liquidity.",
    content: "After months of building in stealth, Emotex Labs is launching the first fully confidential decentralized exchange on Tonkl. No front-running. No MEV. Pure privacy.",
    image: "https://images.unsplash.com/photo-1642104704074-907c0698cbd9?q=80&w=1200&auto=format&fit=crop",
    date: "Yesterday",
    link: "https://emotex.fi",
    views: "12.1k",
    comments: 445,
    likes: "3.1k",
    span: "col-span-1 row-span-1"
  },
  {
    id: 3,
    author: "Tonkl AI",
    handle: "@tonkl_ai",
    avatar: "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?q=80&w=200&auto=format&fit=crop",
    title: "Introducing Voice Mode Analytics",
    summary: "Speak directly to your wallet.",
    content: "Tonkl AI now natively supports voice interactions. By tapping the microphone icon in your chat dashboard, you can trigger Voice Mode.",
    date: "Mar 15, 2026",
    image: "https://images.unsplash.com/photo-1550751827-4bd374c3f58b?q=80&w=1200&auto=format&fit=crop",
    link: "https://tonkl.network/tonkl-ai",
    views: "8.4k",
    comments: 210,
    likes: "1.8k",
    span: "col-span-1 row-span-2"
  },
  {
    id: 4,
    author: "Cyber Sec Daily",
    handle: "@cybersec",
    avatar: "https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?q=80&w=200&auto=format&fit=crop",
    title: "Why L1 Privacy is the Next Cycle",
    summary: "Analysis of the incoming wave of confidential blockchains.",
    content: "As regulatory scrutiny increases on public ledgers, institutional volume is rapidly shifting towards privacy-preserving layers.",
    image: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1200&auto=format&fit=crop",
    date: "Mar 12, 2026",
    views: "45.2k",
    comments: "1.2k",
    likes: "8.9k",
    span: "col-span-1 row-span-1"
  },
  {
    id: 5,
    author: "0xDesigner",
    handle: "@0xdesigner",
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&fit=crop",
    title: "Designing for Privacy First",
    summary: "UX challenges in zero-knowledge interfaces.",
    content: "How do you show users what is happening when the core premise of your application is that no one can see what is happening? Designing for Tonkl has been a masterclass in trust through UI.",
    image: "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?q=80&w=1200&auto=format&fit=crop",
    date: "Mar 10, 2026",
    views: "3.2k",
    comments: 112,
    likes: "405",
    span: "col-span-2 row-span-1"
  }
];

// Generate bento items
const MOCK_NEWS = Array.from({ length: 20 }).map((_, i) => ({
  ...BASE_MOCK_NEWS[i % BASE_MOCK_NEWS.length],
  id: i + 1,
}));

export function NewsDashboard({ onClose }: { onClose: () => void }) {
  const [activePost, setActivePost] = useState(MOCK_NEWS[0]);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="h-screen w-full bg-[#050505] text-white flex flex-col relative overflow-hidden"
    >
      
      {/* 
        =======================================================
        TOP SECTION: The Horizontal Spotlight Billboard 
        =======================================================
      */}
      <div className="relative w-full shrink-0 h-[45vh] border-b-[6px] border-black overflow-hidden flex flex-col">
        {/* Animated Background for Spotlight */}
        <div className="absolute inset-0 z-0 pointer-events-none">
          <Warp
            style={{ height: "100%", width: "100%" }}
            proportion={0.5}
            softness={1}
            distortion={0.3}
            swirl={1.2}
            swirlIterations={10}
            shape="checks"
            shapeScale={0.1}
            scale={1.5}
            rotation={0}
            speed={1}
            colors={[
              "hsl(220, 100%, 12%)",
              "hsl(180, 100%, 18%)",
              "hsl(200, 80%, 8%)",
              "hsl(190, 90%, 22%)",
            ]}
          />
        </div>
        <div className="absolute inset-0 z-0 bg-[#0a0a0a]/50 backdrop-blur-[40px] pointer-events-none" />

        {/* Top Nav (Overlay) */}
        <nav className="relative z-20 flex items-center justify-between w-full p-6 px-12 shrink-0">
          <div className="flex items-center gap-4">
            <Avatar.Root className="w-10 h-10 rounded-full overflow-hidden border-2 border-white/10">
              <Avatar.Image src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop" />
              <Avatar.Fallback className="bg-cyan-900/50 flex items-center justify-center text-cyan-400 font-medium">OS</Avatar.Fallback>
            </Avatar.Root>
            <span className="font-medium text-lg tracking-wide">Ecosystem Updates</span>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 transition-colors">
            <X className="w-6 h-6" />
          </button>
        </nav>

        {/* Spotlight Content Area */}
        <div className="relative z-20 flex-1 flex flex-row items-center px-12 pb-8 gap-12 h-full">
          {/* Post Content (Left) */}
          <motion.div 
            key={`content-${activePost.id}`}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3 }}
            className="flex-1 flex flex-col justify-center h-full max-w-3xl"
          >
            <div className="flex items-center gap-4 mb-6">
              <img src={activePost.avatar} alt={activePost.author} className="w-12 h-12 rounded-full object-cover border border-white/20" />
              <div>
                <h2 className="font-medium text-lg">{activePost.author}</h2>
                <span className="text-cyan-400 text-sm tracking-wide">{activePost.handle} • {activePost.date}</span>
              </div>
            </div>
            
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-light text-white leading-tight mb-6">
              {activePost.title}
            </h1>
            
            <p className="text-lg text-white/60 leading-relaxed font-light mb-8 max-w-2xl line-clamp-3">
              {activePost.content}
            </p>

            {/* Metrics Row */}
            <div className="flex items-center gap-8 text-white/40 font-medium text-sm">
              <div className="flex items-center gap-2"><Eye className="w-5 h-5" /> {activePost.views}</div>
              <div className="flex items-center gap-2"><MessageSquare className="w-5 h-5" /> {activePost.comments}</div>
              <div className="flex items-center gap-2"><Heart className="w-5 h-5" /> {activePost.likes}</div>
              {activePost.link && (
                <a href={activePost.link} target="_blank" rel="noreferrer" className="flex items-center gap-2 ml-4 text-cyan-400 hover:text-cyan-300 transition-colors">
                  Read Full Article <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>
          </motion.div>

          {/* Feature Image (Right) */}
          <motion.div 
            key={`image-${activePost.id}`}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
            className="flex-1 h-full hidden lg:flex items-center justify-end overflow-hidden py-4"
          >
            <div className="relative w-full max-w-2xl h-full rounded-[2rem] overflow-hidden border border-white/10 shadow-2xl group">
              <img 
                src={activePost.image} 
                alt="Feature" 
                className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105" 
              />
              <div className="absolute inset-0 bg-gradient-to-tr from-cyan-900/20 to-transparent pointer-events-none" />
            </div>
          </motion.div>
        </div>
      </div>

      {/* 
        =======================================================
        BOTTOM SECTION: The Bento Grid (Separated by black lines)
        =======================================================
      */}
      <div className="flex-1 w-full bg-black overflow-y-auto custom-scrollbar p-6 pt-0">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 auto-rows-[250px]">
          {MOCK_NEWS.map((post) => (
            <div
              key={post.id}
              onMouseEnter={() => setActivePost(post)}
              className={`relative group cursor-pointer overflow-hidden transition-all duration-300 border-[3px] ${
                activePost.id === post.id ? "border-cyan-400 scale-[0.98]" : "border-transparent"
              } ${post.span}`}
            >
              {/* Edge-to-edge image */}
              <img 
                src={post.image || post.avatar} 
                alt={post.title} 
                className={`w-full h-full object-cover transition-transform duration-700 ${activePost.id === post.id ? 'scale-110' : 'group-hover:scale-105'}`}
              />
              
              {/* Heavy gradient for text legibility */}
              <div className={`absolute inset-0 transition-opacity duration-300 ${activePost.id === post.id ? 'bg-gradient-to-t from-cyan-900/90 via-black/40 to-black/20' : 'bg-gradient-to-t from-black/90 via-black/20 to-transparent group-hover:bg-black/40'}`} />
              
              {/* Overlay Content */}
              <div className="absolute bottom-0 left-0 right-0 p-6 flex flex-col justify-end">
                <span className="text-cyan-400 font-mono text-xs tracking-widest uppercase mb-2 opacity-0 translate-y-4 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300">
                  {post.author}
                </span>
                <h3 className="text-white font-medium text-lg md:text-xl leading-tight line-clamp-2">
                  {post.title}
                </h3>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {/* Global Style for invisible scrollbar within this component */}
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #000; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 0; border: 2px solid #000; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #555; }
      `}} />
    </motion.div>
  );
}
